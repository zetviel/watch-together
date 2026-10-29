import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Smart URL parser and resolver.
 * Detects YouTube, VK Video, Rutube, direct MP4/HLS, or extracts stream info using yt-dlp.
 */
export async function resolveVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is required');
  }

  const url = rawUrl.trim();

  // 1. YouTube detection
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytMatch) {
    const videoId = ytMatch[1];
    return {
      type: 'youtube',
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(process.env.BASE_URL || 'https://watch-together.nlpha.shop')}`,
      title: `YouTube Video (${videoId})`,
      qualities: ['1080p', '720p', '480p', '360p', 'auto'],
      audioTracks: ['Default']
    };
  }

  // 2. RuTube detection
  const rutubeMatch = url.match(/rutube\.ru\/(?:video|play\/embed)\/([a-zA-Z0-9]+)/i);
  if (rutubeMatch) {
    const videoId = rutubeMatch[1];
    // Try yt-dlp first for direct HLS stream (gives full control over quality & audio tracks)
    const directInfo = await tryExtractWithYtDlp(url);
    if (directInfo && directInfo.streamUrl) {
      return {
        ...directInfo,
        type: directInfo.isHls ? 'hls' : 'direct',
        rutubeId: videoId
      };
    }

    return {
      type: 'rutube',
      id: videoId,
      url: `https://rutube.ru/video/${videoId}/`,
      embedUrl: `https://rutube.ru/play/embed/${videoId}`,
      title: `RuTube Video (${videoId})`,
      qualities: ['1080p', '720p', '480p', '360p', 'auto'],
      audioTracks: ['Default']
    };
  }

  // 3. VK Video detection
  // Format 1: vk.com/video-12345_67890 or vkvideo.ru/video-12345_67890
  const vkVideoMatch = url.match(/(?:vk\.com|vkvideo\.ru)\/video(-?\d+)_(\d+)/i);
  // Format 2: vk.com/video_ext.php?oid=-12345&id=67890&hash=...
  const vkExtMatch = url.match(/(?:vk\.com|vkvideo\.ru)\/video_ext\.php\?.*oid=(-?\d+).*id=(\d+)/i);

  if (vkVideoMatch || vkExtMatch) {
    const oid = vkVideoMatch ? vkVideoMatch[1] : vkExtMatch[1];
    const id = vkVideoMatch ? vkVideoMatch[2] : vkExtMatch[2];
    
    // Check if hash parameter is present
    let hash = '';
    try {
      const parsedUrl = new URL(url);
      hash = parsedUrl.searchParams.get('hash') || '';
    } catch {}

    // Try yt-dlp first for VK Video direct streams (qualities / audio tracks)
    const directInfo = await tryExtractWithYtDlp(url);
    if (directInfo && directInfo.streamUrl) {
      return {
        ...directInfo,
        type: directInfo.isHls ? 'hls' : 'direct',
        vkOid: oid,
        vkId: id
      };
    }

    const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ''}&hd=2&autoplay=0`;
    return {
      type: 'vk',
      oid,
      id,
      url,
      embedUrl,
      title: `VK Video (${oid}_${id})`,
      qualities: ['1080p', '720p', '480p', '360p', 'auto'],
      audioTracks: ['Default']
    };
  }

  // 4. Direct video files or HLS stream
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.m3u8')) {
    return {
      type: 'hls',
      url,
      streamUrl: url,
      title: getFilenameFromUrl(url) || 'HLS Live/VOD Stream',
      isHls: true,
      qualities: ['Auto'],
      audioTracks: ['Default']
    };
  }

  if (cleanUrl.endsWith('.mp4') || cleanUrl.endsWith('.webm') || cleanUrl.endsWith('.mov') || cleanUrl.endsWith('.ogv')) {
    return {
      type: 'direct',
      url,
      streamUrl: url,
      title: getFilenameFromUrl(url) || 'Direct Video File',
      isHls: false,
      qualities: ['Source'],
      audioTracks: ['Default']
    };
  }

  // 5. Try deep extraction with yt-dlp for any other site/link
  const directInfo = await tryExtractWithYtDlp(url);
  if (directInfo && directInfo.streamUrl) {
    return {
      ...directInfo,
      type: directInfo.isHls ? 'hls' : 'direct'
    };
  }

  // 6. Generic embed fallback
  return {
    type: 'generic_embed',
    url,
    embedUrl: url,
    title: url,
    qualities: ['Standard'],
    audioTracks: ['Default']
  };
}

/**
 * Run yt-dlp to extract video metadata and direct playback URLs
 */
async function tryExtractWithYtDlp(targetUrl) {
  try {
    const cmd = `yt-dlp --dump-json --no-warnings --no-playlist "${targetUrl.replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(cmd, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    const info = JSON.parse(stdout);

    if (!info) return null;

    let streamUrl = info.url;
    let isHls = false;

    // Check if formats array has HLS (.m3u8) or direct MP4
    const formats = info.formats || [];
    const qualities = [];
    const audioTracks = [];

    // Detect available qualities
    formats.forEach(f => {
      if (f.height) {
        const qName = `${f.height}p`;
        if (!qualities.includes(qName)) {
          qualities.push(qName);
        }
      }
      if (f.language || f.audio_channels) {
        const trackName = f.language_preference || f.language || (f.audio_channels ? `${f.audio_channels}ch` : null);
        if (trackName && !audioTracks.includes(trackName)) {
          audioTracks.push(trackName);
        }
      }
    });

    // If preferred HLS stream exists, use it so Hls.js in browser handles switching smoothly
    const hlsFormat = formats.find(f => (f.url && f.url.includes('.m3u8')) || f.protocol === 'm3u8_native');
    if (hlsFormat) {
      streamUrl = hlsFormat.url;
      isHls = true;
    } else if (streamUrl && streamUrl.includes('.m3u8')) {
      isHls = true;
    }

    // Default fallback qualities if none found
    if (qualities.length === 0) {
      qualities.push('Auto');
    } else {
      qualities.sort((a, b) => parseInt(b) - parseInt(a));
      qualities.push('Auto');
    }

    if (audioTracks.length === 0) {
      audioTracks.push('Default');
    }

    return {
      url: targetUrl,
      streamUrl: streamUrl || targetUrl,
      title: info.title || 'Video',
      duration: info.duration || 0,
      thumbnail: info.thumbnail || '',
      isHls,
      qualities,
      audioTracks
    };
  } catch (err) {
    // yt-dlp failed or not applicable, continue to next fallback
    return null;
  }
}

function getFilenameFromUrl(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname;
    const parts = pathname.split('/');
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return '';
  }
}
