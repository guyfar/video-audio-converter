# Video to Audio Converter

A free, open-source video to audio converter that runs entirely in your browser. No server uploads, no registration required - your files never leave your device.

## Features

- **100% Privacy**: All processing happens locally in your browser using WebAssembly
- **Multiple Formats**: Convert to MP3, WAV, AAC, OGG, or FLAC
- **No Limits**: No file size restrictions, no conversion limits
- **No Registration**: Start converting immediately, no account needed
- **Dark Mode**: Automatic dark mode support based on system preferences

## Supported Input Formats

- MP4
- AVI
- MOV
- MKV
- WebM
- And more video formats

## Demo

Try the full-featured version at **[freevideotoaudio.com](https://freevideotoaudio.com)**

## Tech Stack

- [Next.js](https://nextjs.org/) - React framework
- [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) - WebAssembly port of FFmpeg
- [Tailwind CSS](https://tailwindcss.com/) - Styling

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/guyfar/video-audio-converter.git
cd video-audio-converter

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
```

The static files will be generated in the `out` directory.

## How It Works

This converter uses FFmpeg compiled to WebAssembly, which means:

1. Your video file is read directly in your browser
2. FFmpeg.wasm processes the file locally
3. The extracted audio is generated in your browser
4. You download the result directly - no server involved

## License

MIT License - feel free to use this in your own projects!

## Links

- **Full Version**: [freevideotoaudio.com](https://freevideotoaudio.com)
- **Issues**: [GitHub Issues](https://github.com/guyfar/video-audio-converter/issues)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
