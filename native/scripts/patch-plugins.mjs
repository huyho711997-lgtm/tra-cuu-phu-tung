// Vá nhỏ cho plugin camera trước khi build (chạy trong `npm run sync`, an toàn khi chạy nhiều lần).
// 1) @capgo/camera-preview: setVideoFrameRate() chọn định dạng đầu tiên hỗ trợ fps yêu cầu, thường là định dạng nhỏ (720p).
// Vá lại để giữ nguyên độ phân giải đang dùng (vd 1080p) khi nâng fps lên 60.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '..', 'node_modules/@capgo/camera-preview/ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift');
const MARK = 'TASCO: giữ độ phân giải khi đổi fps';
const OLD = '        guard let targetFormat = device.formats.first(where: { formatSupportsFrameRate($0, frameRate: frameRate) }) else {';
const NEW = `        // ${MARK}
        let currentDims = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
        let currentArea = Int(currentDims.width) * Int(currentDims.height)
        let fpsFormats = device.formats.filter { formatSupportsFrameRate($0, frameRate: frameRate) }
        let sameSize = fpsFormats.first(where: {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return d.width == currentDims.width && d.height == currentDims.height
        })
        let largestNotAbove = fpsFormats
            .filter { f in
                let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
                return Int(d.width) * Int(d.height) <= currentArea
            }
            .max(by: { a, b in
                let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
                let db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
                return Int(da.width) * Int(da.height) < Int(db.width) * Int(db.height)
            })
        guard let targetFormat = sameSize ?? largestNotAbove ?? fpsFormats.first else {`;

async function patchCamera() {
  if (!existsSync(file)) { console.warn('patch-plugins: không thấy CameraController.swift, bỏ qua.'); return; }
  let src = await readFile(file, 'utf8');
  if (src.includes(MARK)) { console.log('patch-plugins: camera đã vá từ trước.'); return; }
  if (!src.includes(OLD)) { console.warn('patch-plugins: không thấy đoạn cần vá camera (plugin đã đổi?), bỏ qua.'); return; }
  await writeFile(file, src.replace(OLD, NEW));
  console.log('patch-plugins: đã vá setVideoFrameRate giữ độ phân giải.');
}

/* @capgo/capacitor-native-biometric: load() đăng ký lắng nghe UIApplication.didBecomeActive rồi gọi
   LAContext.canEvaluatePolicy (2 lần) MỖI LẦN app mở / quay lại, kể cả khi người dùng không bật khoá Face ID.
   iOS vì thế loé biểu tượng Face ID ở góc máy lúc mở app. Web không dùng sự kiện biometryChange nên bỏ hẳn lắng nghe này;
   isAvailable()/verifyIdentity() vẫn chạy bình thường khi web gọi. */
const bioFile = path.resolve(here, '..', 'node_modules/@capgo/capacitor-native-biometric/ios/Sources/NativeBiometricPlugin/NativeBiometricPlugin.swift');
const BIO_MARK = 'TASCO: không dò sinh trắc học khi app active';
async function patchBiometric() {
  if (!existsSync(bioFile)) { console.warn('patch-plugins: không thấy NativeBiometricPlugin.swift, bỏ qua.'); return; }
  let src = await readFile(bioFile, 'utf8');
  if (src.includes(BIO_MARK)) { console.log('patch-plugins: biometric đã vá từ trước.'); return; }
  const re = /override public func load\(\) \{\s*NotificationCenter\.default\.addObserver\(\s*self,\s*selector: #selector\(handleAppDidBecomeActive\),\s*name: UIApplication\.didBecomeActiveNotification,\s*object: nil\s*\)\s*\}/;
  if (!re.test(src)) { console.warn('patch-plugins: không thấy load() của biometric cần vá (plugin đã đổi?), bỏ qua.'); return; }
  await writeFile(bioFile, src.replace(re, `override public func load() {\n        // ${BIO_MARK} (tránh loé biểu tượng Face ID khi mở app)\n    }`));
  console.log('patch-plugins: đã bỏ dò sinh trắc học mỗi lần app active.');
}

await patchCamera();
await patchBiometric();
