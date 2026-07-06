const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i

export function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path)
}
