"""Encode a bounded, proportional WebP preview from stdin to stdout."""
import io
import sys
import warnings

from PIL import Image, ImageOps, ImageSequence

Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
width = int(sys.argv[1])
with Image.open(io.BytesIO(sys.stdin.buffer.read())) as source:
    frames = []
    durations = []
    decoded_pixels = 0
    for frame in ImageSequence.Iterator(source):
        decoded_pixels += frame.width * frame.height
        if len(frames) >= 120 or decoded_pixels > 40_000_000:
            frames = frames[:1]
            durations = durations[:1]
            break
        image = ImageOps.exif_transpose(frame).convert('RGBA')
        image.thumbnail((width, width * 8), Image.Resampling.LANCZOS)
        frames.append(image)
        durations.append(frame.info.get('duration', 100))
    frames[0].save(sys.stdout.buffer, format='WEBP', quality=78, method=4,
                   save_all=len(frames) > 1, append_images=frames[1:],
                   duration=durations, loop=source.info.get('loop', 0))
