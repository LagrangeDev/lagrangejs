const EXT: {[type: number]: string} = {
    3: "png",
    4: "face",
    1000: "jpg",
    1001: "png",
    1002: "webp",
    1003: "jpg",
    1005: "bmp",
    2000: "gif",
    2001: "png",
}

/** 构造图片file */
export function buildImageFileParam(md5: string, size?: number, width?: number, height?: number, type?: number) {
    size = size || 0;
    width = width || 0;
    height = height || 0;
    const ext = EXT[type as number] || "jpg";
    return md5 + size + "-" + width + "-" + height + "." + ext;
}