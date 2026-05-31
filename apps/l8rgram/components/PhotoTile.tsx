import type { Photo } from '../types';

interface Props {
  photo: Photo;
}

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

export const PhotoTile = ({ photo }: Props) => (
  <div className="relative aspect-square bg-(--color-surface-raised) overflow-hidden rounded-(--radius-md)">
    {photo.thumbnailUri ? (
      <img
        src={photo.thumbnailUri}
        alt={photo.caption ?? ''}
        loading="lazy"
        className="w-full h-full object-cover"
      />
    ) : (
      <div className="w-full h-full" />
    )}
    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-(--radius-sm) bg-(--color-surface-overlay)/80 text-(--color-text-secondary) text-xs">
      {formatDate(photo.capturedAt)}
    </div>
  </div>
);
