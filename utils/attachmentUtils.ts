import { Attachment } from '../types';

/** Read files from a FileList and convert to Attachment objects. */
export const processFileInputs = async (files: FileList | File[]): Promise<Attachment[]> => {
    const fileArray = Array.from(files);
    const newAttachments: Attachment[] = [];

    for (const file of fileArray) {
        const reader = new FileReader();
        const result = await new Promise<string>((resolve) => {
            reader.onload = (evt) => resolve(evt.target?.result as string);
            reader.readAsDataURL(file);
        });

        const type = file.type.startsWith('image/') ? 'image' as const : 'file' as const;

        newAttachments.push({
            id: crypto.randomUUID(),
            type,
            mimeType: file.type,
            data: result,
            name: file.name
        });
    }

    return newAttachments;
};
