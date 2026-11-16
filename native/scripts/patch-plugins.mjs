// Vá nhỏ cho plugin camera trước khi build (chạy trong `npm run sync`, an toàn khi chạy nhiều lần).
// @capgo/camera-preview: setVideoFrameRate() chọn định dạng đầu tiên hỗ trợ fps yêu cầu, thường là định dạng nhỏ (720p).
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

if (!existsSync(file)) { console.warn('patch-plugins: không thấy CameraController.swift, bỏ qua.'); process.exit(0); }
let src = await readFile(file, 'utf8');
if (src.includes(MARK)) { console.log('patch-plugins: đã vá từ trước.'); process.exit(0); }
if (!src.includes(OLD)) { console.warn('patch-plugins: không thấy đoạn cần vá (plugin đã đổi?), bỏ qua.'); process.exit(0); }
await writeFile(file, src.replace(OLD, NEW));
console.log('patch-plugins: đã vá setVideoFrameRate giữ độ phân giải.');
