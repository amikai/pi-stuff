import { win32 } from 'node:path'

// resvg-wasm cannot read the disk, so the worker hands it font files itself. pele sizes text with a Helvetica width
// table, so each platform leads with a metric-compatible font: Helvetica on macOS, Arial on Windows, Liberation Sans
// on Linux. The fonts after it fill in Chinese, Japanese, Hebrew and Arabic. Paths that do not exist are skipped.
export const fontCandidates = (platform = process.platform, env = process.env) => {
  if (platform === 'darwin') {
    return [
      { family: 'Helvetica', path: '/System/Library/Fonts/Helvetica.ttc' },
      { family: 'Hiragino Sans GB', path: '/System/Library/Fonts/Hiragino Sans GB.ttc' },
      { family: 'SF Hebrew', path: '/System/Library/Fonts/SFHebrew.ttf' },
      { family: 'Geeza Pro', path: '/System/Library/Fonts/GeezaPro.ttc' },
    ]
  }
  if (platform === 'win32') {
    const fonts = win32.join(env.WINDIR ?? env.SystemRoot ?? 'C:\\Windows', 'Fonts')
    // Windows' Arial also covers Hebrew and Arabic.
    return [
      { family: 'Arial', path: win32.join(fonts, 'arial.ttf') },
      { family: 'Arial', path: win32.join(fonts, 'arialbd.ttf') },
      { family: 'Microsoft JhengHei', path: win32.join(fonts, 'msjh.ttc') },
      { family: 'Microsoft YaHei', path: win32.join(fonts, 'msyh.ttc') },
    ]
  }
  return [
    { family: 'Liberation Sans', path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' },
    { family: 'Liberation Sans', path: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' },
    { family: 'Liberation Sans', path: '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf' },
    { family: 'Liberation Sans', path: '/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf' },
    { family: 'DejaVu Sans', path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
    { family: 'Noto Sans CJK TC', path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc' },
    { family: 'Noto Sans CJK TC', path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc' },
  ]
}
