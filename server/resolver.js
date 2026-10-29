import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Smart URL parser and resolver.
 * Detects YouTube, VK Video, RuTube, Yandex Video preview, movie player CDNs, HLS (.m3u8), MP4, or proxy embeds.
 */
export async function resolveVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is required');
  }

  let url = rawUrl.trim();

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
      qualities: ['1080p', '720p', '480p', '360p', 'Auto'],
      audioTracks: ['Default']
    };
  }

  // 2. Yandex Video Preview detection (e.g. m.yandex.ru/video/preview/5475430006811771212)
  const yandexMatch = url.match(/(?:yandex\.[a-z]+|ya\.ru)\/video\/preview\/(\d+)/i);
  if (yandexMatch) {
    try {
      const yandexId = yandexMatch[1];
      const targetUrl = `https://yandex.ru/video/preview/${yandexId}`;
      const resp = await axios.get(targetUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8'
        },
        timeout: 10000
      });

      const html = resp.data;
      // Look for real underlying video URL in Yandex preview HTML
      const embeddedUrlMatch = html.match(
        /https?:\/\/(?:www\.)?(?:rutube\.ru\/(?:video|play\/embed)|youtube\.com\/watch\?v=|youtu\.be\/|vk\.com\/video|vkvideo\.ru\/video)[^"'\s&<>]+/i
      );

      if (embeddedUrlMatch) {
        const underlyingUrl = embeddedUrlMatch[0];
        console.log(`[Yandex Video] Extracted underlying video: ${underlyingUrl}`);
        // Recursively resolve the real target video
        const resolved = await resolveVideoUrl(underlyingUrl);
        // Try to get clean title from Yandex page
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          resolved.title = titleMatch[1].replace(/ — Смотрите видео онлайн.*$/i, '').trim();
        }
        return resolved;
      }
    } catch (err) {
      console.warn('[Yandex Video] Failed to extract from preview, fallback:', err.message);
    }
  }

  // 3. RuTube detection
  const rutubeMatch = url.match(/rutube\.ru\/(?:video|play\/embed)\/([a-zA-Z0-9]+)/i);
  if (rutubeMatch) {
    const videoId = rutubeMatch[1];
    return {
      type: 'rutube',
      id: videoId,
      url: `https://rutube.ru/video/${videoId}/`,
      embedUrl: `https://rutube.ru/play/embed/${videoId}`,
      title: `RuTube Video (${videoId})`,
      qualities: ['1080p', '720p', '480p', '360p', 'Auto'],
      audioTracks: ['Default']
    };
  }

  // 4. VK Video detection (vk.com/video... or vkvideo.ru/video...)
  const vkVideoMatch = url.match(/(?:vk\.com|vkvideo\.ru)\/video(-?\d+)_(\d+)/i);
  const vkExtMatch = url.match(/(?:vk\.com|vkvideo\.ru)\/video_ext\.php\?.*oid=(-?\d+).*id=(\d+)/i);

  if (vkVideoMatch || vkExtMatch) {
    const oid = vkVideoMatch ? vkVideoMatch[1] : vkExtMatch[1];
    const id = vkVideoMatch ? vkVideoMatch[2] : vkExtMatch[2];

    let hash = '';
    try {
      const parsedUrl = new URL(url);
      hash = parsedUrl.searchParams.get('hash') || '';
    } catch {}

    // Use official VK embed player to ensure universal playback worldwide without IP-binding errors
    const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ''}&hd=2&autoplay=0`;
    
    // Try to get clean video title using yt-dlp metadata
    let title = `VK Video (${oid}_${id})`;
    try {
      const directInfo = await tryExtractWithYtDlp(url);
      if (directInfo && directInfo.title) {
        title = directInfo.title;
      }
    } catch {}

    return {
      type: 'vk',
      oid,
      id,
      url: `https://vkvideo.ru/video${oid}_${id}`,
      embedUrl,
      title,
      qualities: ['1080p', '720p', '480p', '360p', 'Auto'],
      audioTracks: ['Default']
    };
  }

  // 5. Popular Movie & Series Player Embeds (Kodik, Collaps, VideoCDN, Alloha, Voidboost, CDNmovies)
  const isMoviePlayerCdn = /(?:kodik\.(?:info|cc|biz)|aniqit\.com|anivod\.com|collaps\.org|namy\.ws|vplay\.one|delivembed\.cc|videocdn\.tv|o249\.tv|alloha\.tv|voidboost\.(?:net|cc)|cdnmovies-stream\.online)/i.test(url);
  if (isMoviePlayerCdn) {
    let cleanEmbed = url;
    if (cleanEmbed.startsWith('//')) {
      cleanEmbed = 'https:' + cleanEmbed;
    }
    return {
      type: 'generic_embed',
      url: cleanEmbed,
      embedUrl: cleanEmbed,
      title: 'Плеер фильма/сериала',
      qualities: ['1080p', '720p', '480p', 'Auto'],
      audioTracks: ['Озвучка из плеера']
    };
  }

  // 6. Direct Video Files or HLS Stream
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

  // 7. Try deep extraction with yt-dlp (for other sites)
  const directInfo = await tryExtractWithYtDlp(url);
  if (directInfo && directInfo.streamUrl) {
    return {
      ...directInfo,
      type: directInfo.isHls ? 'hls' : 'direct'
    };
  }

  // 8. Movie/Series Website inspection (search for player iframes inside HTML)
  try {
    const pageResp = await axios.get(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      },
      timeout: 5000
    });

    const pageHtml = pageResp.data;
    if (typeof pageHtml === 'string') {
      // Find embedded iframe players in the HTML
      const iframeMatch = pageHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1]) {
        let playerSrc = iframeMatch[1];
        if (playerSrc.startsWith('//')) playerSrc = 'https:' + playerSrc;
        else if (playerSrc.startsWith('/')) playerSrc = new URL(playerSrc, url).toString();

        console.log(`[Web Inspector] Found player iframe inside page: ${playerSrc}`);
        // If the player inside is a known video URL, resolve it!
        return await resolveVideoUrl(playerSrc);
      }
    }
  } catch (err) {
    // Page fetch failed (e.g. anti-bot/geo-lock on movie sites), continue to proxy embed
  }

  // 9. Generic Embed Fallback (routed through /api/proxy-embed if needed)
  return {
    type: 'generic_embed',
    url,
    embedUrl: `/api/proxy-embed?url=${encodeURIComponent(url)}`,
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
    const { stdout } = await execAsync(cmd, { timeout: 12000, maxBuffer: 10 * 1024 * 1024 });
    const info = JSON.parse(stdout);

    if (!info) return null;

    let streamUrl = info.url;
    let isHls = false;

    // Reject OKCDN IP-bound URLs from direct playback (causes 403 in client browsers)
    if (streamUrl && streamUrl.includes('okcdn.ru')) {
      return null;
    }

    const formats = info.formats || [];
    const qualities = [];
    const audioTracks = [];

    formats.forEach((f) => {
      if (f.height) {
        const qName = `${f.height}p`;
        if (!qualities.includes(qName)) qualities.push(qName);
      }
      if (f.language || f.audio_channels) {
        const trackName = f.language_preference || f.language || (f.audio_channels ? `${f.audio_channels}ch` : null);
        if (trackName && !audioTracks.includes(trackName)) {
          audioTracks.push(trackName);
        }
      }
    });

    const hlsFormat = formats.find((f) => (f.url && f.url.includes('.m3u8')) || f.protocol === 'm3u8_native');
    if (hlsFormat && !hlsFormat.url.includes('okcdn.ru')) {
      streamUrl = hlsFormat.url;
      isHls = true;
    } else if (streamUrl && streamUrl.includes('.m3u8')) {
      isHls = true;
    }

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
  } catch {
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
