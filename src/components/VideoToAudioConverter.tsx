"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";

type ConversionStatus = "idle" | "loading" | "ready" | "converting" | "done" | "error";

interface LoadingStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
  progress?: number;
}

interface FileInfo {
  name: string;
  size: number;
  type: string;
}

interface AudioFormat {
  id: string;
  name: string;
  extension: string;
  codec: string;
  mimeType: string;
  quality?: string[];
}

const AUDIO_FORMATS: AudioFormat[] = [
  { id: "mp3", name: "MP3", extension: "mp3", codec: "libmp3lame", mimeType: "audio/mpeg", quality: ["-q:a", "2"] },
  { id: "wav", name: "WAV", extension: "wav", codec: "pcm_s16le", mimeType: "audio/wav" },
  { id: "aac", name: "AAC", extension: "m4a", codec: "aac", mimeType: "audio/mp4", quality: ["-b:a", "192k"] },
  { id: "ogg", name: "OGG", extension: "ogg", codec: "libvorbis", mimeType: "audio/ogg", quality: ["-q:a", "6"] },
  { id: "flac", name: "FLAC", extension: "flac", codec: "flac", mimeType: "audio/flac" },
];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function estimateConversionTime(fileSize: number): string {
  const seconds = Math.ceil(fileSize / (2 * 1024 * 1024));
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}min`;
}

export default function VideoToAudioConverter() {
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<AudioFormat>(AUDIO_FORMATS[0]);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [outputSize, setOutputSize] = useState<number>(0);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [hasAudioTrack, setHasAudioTrack] = useState<boolean>(true);
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>([]);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadedRef = useRef<boolean>(false);
  const ffmpegLogsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const initLoadingSteps = useCallback((isFirstLoad: boolean) => {
    const steps: LoadingStep[] = [];
    if (isFirstLoad) {
      steps.push({ id: "ffmpeg", label: "Downloading converter...", status: "pending" });
    }
    steps.push({ id: "read", label: "Reading video file", status: "pending" });
    steps.push({ id: "analyze", label: "Analyzing video", status: "pending" });
    setLoadingSteps(steps);
    return steps;
  }, []);

  const updateStepStatus = useCallback((stepId: string, status: LoadingStep["status"], progress?: number) => {
    setLoadingSteps(prev => prev.map(step =>
      step.id === stepId ? { ...step, status, progress } : step
    ));
  }, []);

  const readFileWithProgress = useCallback((file: File, onProgress: (percent: number) => void): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        resolve(new Uint8Array(arrayBuffer));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const fetchWithProgress = useCallback(async (
    url: string,
    onProgress: (loaded: number) => void
  ): Promise<Blob> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not supported');
    }

    const chunks: ArrayBuffer[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value.buffer as ArrayBuffer);
      loaded += value.length;
      onProgress(loaded);
    }

    return new Blob(chunks);
  }, []);

  const blobToURL = useCallback((blob: Blob, mimeType: string): string => {
    const blobWithType = new Blob([blob], { type: mimeType });
    return URL.createObjectURL(blobWithType);
  }, []);

  const loadFFmpeg = async (onProgress?: (downloadedMB: string) => void) => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(Math.round(progress * 100));
    });
    ffmpeg.on("log", ({ message }) => {
      ffmpegLogsRef.current.push(message);
    });

    const cdnList = [
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd",
    ];

    let lastError: Error | null = null;
    const TIMEOUT_MS = 300000;

    for (const baseURL of cdnList) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Loading timeout")), TIMEOUT_MS);
        });

        const loadPromise = (async () => {
          const jsBlob = await fetchWithProgress(
            `${baseURL}/ffmpeg-core.js`,
            () => {}
          );
          const coreURL = blobToURL(jsBlob, "text/javascript");

          const wasmBlob = await fetchWithProgress(
            `${baseURL}/ffmpeg-core.wasm`,
            (loaded) => {
              if (onProgress) {
                const downloadedMB = (loaded / 1024 / 1024).toFixed(1);
                onProgress(downloadedMB);
              }
            }
          );
          const wasmURL = blobToURL(wasmBlob, "application/wasm");

          await ffmpeg.load({ coreURL, wasmURL });
        })();

        await Promise.race([loadPromise, timeoutPromise]);
        lastError = null;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    if (lastError) {
      throw new Error("Failed to load converter. Please check your network connection and try again.");
    }

    ffmpegRef.current = ffmpeg;
    ffmpegLoadedRef.current = true;
    return ffmpeg;
  };

  const analyzeVideo = useCallback(async (file: File) => {
    setError(null);
    setAudioUrl(null);
    setProgress(0);
    setCurrentFile(file);
    setFileInfo({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    try {
      setStatus("loading");

      const isFirstLoad = !ffmpegLoadedRef.current;
      initLoadingSteps(isFirstLoad);

      if (isFirstLoad) {
        updateStepStatus("ffmpeg", "active");
      }
      const ffmpeg = await loadFFmpeg((downloadedMB) => {
        if (isFirstLoad) {
          setLoadingSteps(prev => prev.map(step =>
            step.id === "ffmpeg"
              ? { ...step, label: `Downloading converter (${downloadedMB}MB downloaded)` }
              : step
          ));
        }
      });
      if (isFirstLoad) {
        updateStepStatus("ffmpeg", "done");
      }

      updateStepStatus("read", "active");
      const inputFileName = "input" + file.name.substring(file.name.lastIndexOf("."));
      const fileData = await readFileWithProgress(file, (percent) => {
        updateStepStatus("read", "active", percent);
      });
      await ffmpeg.writeFile(inputFileName, fileData);
      updateStepStatus("read", "done", 100);

      updateStepStatus("analyze", "active");

      ffmpegLogsRef.current = [];
      try {
        await ffmpeg.exec(["-i", inputFileName, "-hide_banner"]);
      } catch {
        // FFmpeg always "fails" on -i only command, but we got the logs we need
      }

      const hasAudio = ffmpegLogsRef.current.some(log =>
        log.includes("Audio:") || log.includes("Stream #") && log.toLowerCase().includes("audio")
      );
      setHasAudioTrack(hasAudio);

      let duration = 0;
      const videoUrl = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          duration = Math.max(60, file.size / (1024 * 1024) * 10);
          resolve();
        }, 8000);

        video.onloadedmetadata = () => {
          clearTimeout(timeout);
          duration = video.duration;
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timeout);
          duration = Math.max(60, file.size / (1024 * 1024) * 10);
          resolve();
        };
        video.src = videoUrl;
      });
      URL.revokeObjectURL(videoUrl);

      updateStepStatus("analyze", "done");

      setVideoDuration(duration);
      setFileName(file.name.replace(/\.[^/.]+$/, "") + "." + selectedFormat.extension);
      setStatus("ready");

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to analyze video";
      setError(errorMsg);
      setStatus("error");
    }
  }, [selectedFormat.extension, initLoadingSteps, updateStepStatus, readFileWithProgress]);

  const startConversion = useCallback(async () => {
    if (!currentFile || !ffmpegRef.current) return;

    try {
      setStatus("converting");
      setProgress(0);

      const ffmpeg = ffmpegRef.current;
      const inputFileName = "input" + currentFile.name.substring(currentFile.name.lastIndexOf("."));
      const outputFileName = `output.${selectedFormat.extension}`;

      const args: string[] = ["-i", inputFileName];
      args.push("-vn");
      args.push("-acodec", selectedFormat.codec);

      if (selectedFormat.quality) {
        args.push(...selectedFormat.quality);
      }

      args.push(outputFileName);

      await ffmpeg.exec(args);

      const data = await ffmpeg.readFile(outputFileName);
      const blob = new Blob([data as BlobPart], { type: selectedFormat.mimeType });
      const url = URL.createObjectURL(blob);

      setOutputSize(blob.size);
      setAudioUrl(url);
      setStatus("done");
      await ffmpeg.deleteFile(outputFileName);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Conversion failed";
      setError(errorMsg);
      setStatus("error");
    }
  }, [currentFile, selectedFormat]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) analyzeVideo(file);
    },
    [analyzeVideo]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("video/")) {
          analyzeVideo(file);
        } else {
          setError("Please drop a video file");
          setStatus("error");
        }
      }
    },
    [analyzeVideo]
  );

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = fileName;
    a.click();
  };

  const handleReset = () => {
    setStatus("idle");
    setProgress(0);
    setError(null);
    setAudioUrl(null);
    setFileName("");
    setFileInfo(null);
    setCurrentFile(null);
    setVideoDuration(0);
    setOutputSize(0);
    setHasAudioTrack(true);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    if (currentFile) {
      setFileName(currentFile.name.replace(/\.[^/.]+$/, "") + "." + selectedFormat.extension);
    }
  }, [selectedFormat, currentFile]);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        {/* Idle - Upload Area */}
        {status === "idle" && (
          <label
            className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300 ${
              isDragging
                ? "border-blue-500 bg-blue-100 dark:bg-blue-900/30 scale-[1.02]"
                : "border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:border-blue-400"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <div className={`mb-4 transition-transform duration-300 ${isDragging ? "scale-110 -translate-y-2" : ""}`}>
                <svg
                  className={`w-12 h-12 ${isDragging ? "text-blue-600" : "text-blue-500"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="mb-2 text-lg font-semibold text-gray-700 dark:text-gray-200">
                {isDragging ? "Drop your video here" : "Drop video or click to upload"}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                MP4, AVI, MOV, MKV, WebM (Max 500MB)
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="video/*"
              onChange={handleFileSelect}
            />
          </label>
        )}

        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center justify-center py-8">
            {fileInfo && (
              <div className="mb-6 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-4 py-2 rounded-lg">
                <span className="font-medium text-gray-700 dark:text-gray-200">{fileInfo.name}</span>
                <span className="mx-2">•</span>
                <span>{formatFileSize(fileInfo.size)}</span>
              </div>
            )}

            <div className="w-full max-w-sm space-y-3">
              {loadingSteps.map((step, index) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                    step.status === "active"
                      ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                      : step.status === "done"
                      ? "bg-green-50 dark:bg-green-900/20"
                      : "bg-gray-50 dark:bg-gray-700/50"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {step.status === "done" ? (
                      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : step.status === "active" ? (
                      <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-500"></div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      step.status === "active"
                        ? "text-blue-700 dark:text-blue-300"
                        : step.status === "done"
                        ? "text-green-700 dark:text-green-300"
                        : "text-gray-500 dark:text-gray-400"
                    }`}>
                      {step.label}
                    </p>
                    {step.status === "active" && step.progress !== undefined && (
                      <div className="mt-1.5">
                        <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                            style={{ width: `${step.progress}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{step.progress}%</p>
                      </div>
                    )}
                  </div>

                  <div className={`flex-shrink-0 text-xs font-medium ${
                    step.status === "done"
                      ? "text-green-500"
                      : step.status === "active"
                      ? "text-blue-500"
                      : "text-gray-400"
                  }`}>
                    {index + 1}/{loadingSteps.length}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-sm text-gray-400 dark:text-gray-500 mt-6 text-center">
              {loadingSteps.some(s => s.id === "ffmpeg" && s.status !== "done")
                ? "Loading converter for the first time..."
                : "Processing in your browser"}
            </p>
          </div>
        )}

        {/* Ready */}
        {status === "ready" && (
          <div className="space-y-6">
            {fileInfo && (
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 px-4 py-3 rounded-lg">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-800 dark:text-white">{fileInfo.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatFileSize(fileInfo.size)} • {formatTime(videoDuration)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Format Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Output Format
              </label>
              <div className="flex flex-wrap gap-2">
                {AUDIO_FORMATS.map((format) => (
                  <button
                    key={format.id}
                    onClick={() => setSelectedFormat(format)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      selectedFormat.id === format.id
                        ? "bg-blue-600 text-white shadow-md"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}
                  >
                    {format.name}
                  </button>
                ))}
              </div>
            </div>

            {/* No Audio Warning */}
            {!hasAudioTrack && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-4 rounded-lg">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">No audio track found</p>
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      This video file does not contain an audio track. Audio extraction is not possible.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="mt-4 w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Convert Another Video
                </button>
              </div>
            )}

            {/* Convert Button */}
            <button
              onClick={startConversion}
              disabled={!hasAudioTrack}
              className={`w-full py-4 font-semibold rounded-xl transition-all ${
                hasAudioTrack
                  ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg hover:from-blue-700 hover:to-blue-800 hover:shadow-xl transform hover:-translate-y-0.5"
                  : "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {hasAudioTrack ? `Convert to ${selectedFormat.name}` : "No Audio to Extract"}
              </span>
            </button>
          </div>
        )}

        {/* Converting */}
        {status === "converting" && (
          <div className="flex flex-col items-center justify-center py-8">
            {fileInfo && (
              <div className="mb-6 text-center">
                <div className="inline-flex items-center gap-2 bg-gray-50 dark:bg-gray-700 px-4 py-2 rounded-lg">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{fileInfo.name}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">{selectedFormat.name}</span>
                </div>
              </div>
            )}

            <div className="w-full max-w-md mb-4">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Converting...
                </span>
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  {progress}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(progress, 2)}%` }}
                ></div>
              </div>
            </div>

            {fileInfo && progress < 100 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                Estimated time: {estimateConversionTime(fileInfo.size * (1 - progress / 100))}
              </p>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400">
              Processing in your browser - your file never leaves your device
            </p>
          </div>
        )}

        {/* Done */}
        {status === "done" && audioUrl && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="text-green-500 mb-4">
              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <p className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              Conversion Complete!
            </p>
            <p className="text-gray-500 dark:text-gray-400 mb-1">{fileName}</p>
            <p className="text-sm text-blue-600 dark:text-blue-400 mb-6">
              Output size: {formatFileSize(outputSize)}
            </p>

            <div className="flex gap-4 mb-6">
              <button
                onClick={handleDownload}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download {selectedFormat.name}
                </span>
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Convert Another
              </button>
            </div>

            <div className="w-full max-w-md">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 text-center">Preview:</p>
              <audio
                key={audioUrl}
                controls
                controlsList="nodownload"
                className="w-full"
                preload="auto"
                playsInline
              >
                <source src={audioUrl || ""} type={selectedFormat.mimeType} />
                Your browser does not support the audio element.
              </audio>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="text-red-500 mb-4">
              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              Conversion Failed
            </p>
            <p className="text-gray-500 dark:text-gray-400 mb-6 text-center max-w-md">{error}</p>
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-4 mt-8">
        <div className="text-center p-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <div className="text-3xl mb-2">🔒</div>
          <p className="font-semibold text-gray-800 dark:text-white">100% Private</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Files never leave your device</p>
        </div>
        <div className="text-center p-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <div className="text-3xl mb-2">⚡</div>
          <p className="font-semibold text-gray-800 dark:text-white">Fast Conversion</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Powered by WebAssembly</p>
        </div>
        <div className="text-center p-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <div className="text-3xl mb-2">🆓</div>
          <p className="font-semibold text-gray-800 dark:text-white">Free Forever</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">No limits, no registration</p>
        </div>
      </div>
    </div>
  );
}
