import VideoToAudioConverter from "@/components/VideoToAudioConverter";

export default function Home() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
          Video to Audio Converter
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Extract audio from any video file. Fast, free, and 100% private -
          all processing happens directly in your browser.
        </p>
      </div>

      <VideoToAudioConverter />

      <footer className="mt-16 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>
          Try our full-featured version at{" "}
          <a
            href="https://freevideotoaudio.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            freevideotoaudio.com
          </a>
        </p>
      </footer>
    </main>
  );
}
