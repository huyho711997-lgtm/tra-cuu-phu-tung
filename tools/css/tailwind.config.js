// Giữ nguyên cấu hình từng khai báo trong mobile.html (tailwind.config = {...}).
module.exports = {
  darkMode: 'class',
  content: ['../../mobile.html'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#edf5f7', 100: '#daecf0', 200: '#b6cedd', 300: '#8daac3', 400: '#5d7c9b', 500: '#183056', 600: '#102440', 700: '#0d2039', 800: '#0b1b30', 900: '#071423' },
        teal: { 50: '#edf5f7', 100: '#daecf0', 200: '#b8dce2', 300: '#9dcfd6', 400: '#84bfc7', 500: '#63adb6', 600: '#39747e', 700: '#2c5b65', 800: '#20434f', 900: '#142f3d' }
      }
    }
  }
};
