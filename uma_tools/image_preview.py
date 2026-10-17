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
    for frame in ImageSequence.Iterator(source):
        image = ImageOps.exif_transpose(frame).convert('RGBA')
        image.thumbnail((width, width * 8), Image.Resampling.LANCZOS)
        frames.append(image)
        durations.append(frame.info.get('duration', 100))
    frames[0].save(sys.stdout.buffer, format='WEBP', quality=78, method=4,
                   save_all=len(frames) > 1, append_images=frames[1:],
                   duration=durations, loop=source.info.get('loop', 0))
