# MediaConvert.sh

A minimal, local-first FFmpeg interface. Files are uploaded to a temporary directory on the same machine, processed by FFmpeg, and served back through a localhost-only Express server.

## Requirements

- Node.js 18+ recommended
- FFmpeg with `ffmpeg` and `ffprobe` available in `PATH`
- A desktop browser

## Run

```bash
chmod +x mediaconvert.sh
./mediaconvert.sh
```

On the first launch, `npm install` downloads the JavaScript dependencies. After that, conversion itself is local and does not require an internet connection.

## Supported outputs

### Video

- MP4
- MKV
- WebM
- MOV

### Audio

- MP3
- WAV
- FLAC

### Images

- PNG
- JPEG
- WebP
- AVIF
- GIF
- BMP
- TIFF

The output list is input-aware. Images show image formats first, audio files show audio formats, and video files can also extract their first frame as an image. The app does not expose nonsensical audio-to-image or image-to-audio conversions in the UI.

Image outputs intentionally produce a single frame. For an animated image or video, selecting an image format extracts the first frame.

The backend probes input streams with `ffprobe` and uses stream copy/remuxing when the target container and codecs are compatible. Otherwise it selects a high-quality transcode path.

## Development

```bash
npm install
npm run dev
```

For production-style local serving, let `mediaconvert.sh` build and launch the app.
