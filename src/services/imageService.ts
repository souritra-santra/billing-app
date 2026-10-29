import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export interface PreparedAiImage {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mimeType: 'image/jpeg';
  uri: string;
  width?: number;
  height?: number;
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.65;

function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null)
    );
  });
}

/**
 * Normalise any picked image to a reasonably small JPEG before sending it to
 * the proxy. This keeps payloads under the provider's inline-image limit and
 * converts formats such as HEIC that Gemini may not accept.
 */
export async function prepareImageForAi(
  uri: string,
  knownSize?: { width?: number; height?: number }
): Promise<PreparedAiImage> {
  const size = knownSize?.width && knownSize?.height
    ? { width: knownSize.width, height: knownSize.height }
    : await getImageSize(uri);

  const actions: Parameters<typeof manipulateAsync>[1] = [];
  if (size) {
    const largest = Math.max(size.width, size.height);
    if (largest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / largest;
      actions.push({
        resize: {
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
        },
      });
    }
  } else {
    // Unknown dimensions: cap the width; height follows the aspect ratio.
    actions.push({ resize: { width: MAX_DIMENSION } });
  }

  const result = await manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error('Could not prepare the image for upload');
  }

  return {
    base64: result.base64,
    mimeType: 'image/jpeg',
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}
