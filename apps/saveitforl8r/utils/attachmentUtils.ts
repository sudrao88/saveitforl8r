import { Attachment } from '../types';

/** Maximum file size allowed for upload (50MB). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Maximum number of attachments per memory (must match server limit in server/middleware/validation.js). */
export const MAX_ATTACHMENTS = 20;

/** Max width or height for compressed images. */
const IMAGE_MAX_DIMENSION = 2048;

/** JPEG quality for compressed images (0-1). */
const IMAGE_COMPRESSION_QUALITY = 0.85;

/** Only compress images larger than this threshold (2MB). */
const IMAGE_COMPRESSION_THRESHOLD = 2 * 1024 * 1024;

export interface ProcessFileResult {
    attachments: Attachment[];
    rejected: { name: string; size: number }[];
}

/**
 * Compress an image file by resizing it to fit within IMAGE_MAX_DIMENSION
 * and re-encoding as JPEG. Returns the original file if compression fails
 * or the image is already small enough.
 */
export const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(url);

                const { width, height } = img;

                // Skip if already within bounds and under threshold
                if (width <= IMAGE_MAX_DIMENSION && height <= IMAGE_MAX_DIMENSION && file.size <= IMAGE_COMPRESSION_THRESHOLD) {
                    resolve(file);
                    return;
                }

                // Calculate scaled dimensions preserving aspect ratio
                let newWidth = width;
                let newHeight = height;
                if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
                    const ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
                    newWidth = Math.round(width * ratio);
                    newHeight = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = newWidth;
                canvas.height = newHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(file);
                    return;
                }

                ctx.drawImage(img, 0, 0, newWidth, newHeight);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            resolve(file);
                            return;
                        }
                        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                            type: 'image/jpeg',
                            lastModified: Date.now(),
                        }));
                    },
                    'image/jpeg',
                    IMAGE_COMPRESSION_QUALITY,
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(file);
            };

            img.src = url;
        } catch {
            resolve(file);
        }
    });
};

/** Read files from a FileList and convert to Attachment objects. */
export const processFileInputs = async (files: FileList | File[]): Promise<ProcessFileResult> => {
    const fileArray = Array.from(files);
    const attachments: Attachment[] = [];
    const rejected: { name: string; size: number }[] = [];

    for (const rawFile of fileArray) {
        // Reject files over the size limit
        if (rawFile.size > MAX_FILE_SIZE_BYTES) {
            rejected.push({ name: rawFile.name, size: rawFile.size });
            continue;
        }

        // Compress large images
        let file = rawFile;
        if (rawFile.type.startsWith('image/') && rawFile.size > IMAGE_COMPRESSION_THRESHOLD) {
            file = await compressImage(rawFile);
        }

        const reader = new FileReader();
        const result = await new Promise<string>((resolve) => {
            reader.onload = (evt) => resolve(evt.target?.result as string);
            reader.readAsDataURL(file);
        });

        const type = file.type.startsWith('image/') ? 'image' as const : 'file' as const;

        // Use the compressed file's name if compression changed the format,
        // otherwise keep the original name the user selected.
        const displayName = (file !== rawFile && file.name !== rawFile.name)
            ? file.name
            : rawFile.name;

        attachments.push({
            id: crypto.randomUUID(),
            type,
            mimeType: file.type,
            data: result,
            name: displayName
        });
    }

    return { attachments, rejected };
};
