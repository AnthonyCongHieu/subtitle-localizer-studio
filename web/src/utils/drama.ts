import { ProjectManifestV1 } from '../types/api';

/**
 * Trích xuất tên bộ phim và số tập từ tiêu đề hoặc đường dẫn video.
 */
export const extractDramaInfo = (
  title: string,
  videoPath?: string
): { dramaTitle: string; episodeNumber: number } => {
  const episodePattern = /[\s\-_]+(?:tập|tap|ep|episode|phần|#|s\d+e)[\s\-_\.]*(\d+).*$/i;
  const match = title.match(episodePattern);

  if (match) {
    const dramaName = title.slice(0, match.index).replace(/[\s\-_]+$/, '').trim();
    const epNum = parseInt(match[1], 10);
    return {
      dramaTitle: dramaName || 'Video đơn lẻ / Chưa phân loại',
      episodeNumber: isNaN(epNum) ? 1 : epNum,
    };
  }

  const startsWithEpPattern = /^(?:tập|tap|ep|episode|phần|#)\s*(\d+)/i;
  const matchStart = title.match(startsWithEpPattern);
  if (matchStart) {
    if (videoPath) {
      const normalized = videoPath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      if (parts.length >= 2) {
        const parentFolder = parts[parts.length - 2];
        if (parentFolder && !['uploads', 'videos', 'downloads', 'temp', 'src'].includes(parentFolder.toLowerCase())) {
          return {
            dramaTitle: parentFolder,
            episodeNumber: parseInt(matchStart[1], 10),
          };
        }
      }
    }
  }

  if (videoPath) {
    const normalized = videoPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length >= 2) {
      const parentFolder = parts[parts.length - 2];
      if (parentFolder && !['uploads', 'videos', 'downloads', 'temp', 'src'].includes(parentFolder.toLowerCase())) {
        return {
          dramaTitle: parentFolder,
          episodeNumber: 1,
        };
      }
    }
  }

  return {
    dramaTitle: 'Video đơn lẻ / Chưa phân loại',
    episodeNumber: 1,
  };
};

export const extractEpisodeNumber = (title: string): number => {
  return extractDramaInfo(title).episodeNumber;
};

/**
 * Sắp xếp tự nhiên (Natural Sort) danh sách tập phim theo số tập tăng/giảm dần
 */
export const sortProjectsNaturally = (
  projects: ProjectManifestV1[],
  order: 'asc' | 'desc' = 'asc'
): ProjectManifestV1[] => {
  return [...projects].sort((a, b) => {
    const infoA = extractDramaInfo(a.title, a.source_video_path);
    const infoB = extractDramaInfo(b.title, b.source_video_path);
    
    if (infoA.episodeNumber !== infoB.episodeNumber) {
      return order === 'asc'
        ? infoA.episodeNumber - infoB.episodeNumber
        : infoB.episodeNumber - infoA.episodeNumber;
    }
    
    return order === 'asc'
      ? a.title.localeCompare(b.title, 'vi', { numeric: true, sensitivity: 'base' })
      : b.title.localeCompare(a.title, 'vi', { numeric: true, sensitivity: 'base' });
  });
};
