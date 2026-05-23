import { useRef, useState, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ROAR_START = 29
const ROAR_END = 36

export default function App() {
  const ffmpegRef = useRef(new FFmpeg())
  const fileInputRef = useRef(null)
  const resultRef = useRef(null)

  const [ffmpegReady, setFfmpegReady] = useState(false)
  const [ffmpegLoading, setFfmpegLoading] = useState(true)
  const [audioFile, setAudioFile] = useState(null)
  const [audioName, setAudioName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultUrl, setResultUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadFFmpeg()
  }, [])

  useEffect(() => {
    if (resultUrl && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [resultUrl])

  async function loadFFmpeg() {
    const ffmpeg = ffmpegRef.current
    ffmpeg.on('progress', ({ progress }) => {
      setProgress(Math.round(progress * 100))
    })
    try {
      const base = import.meta.env.BASE_URL
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm'),
      })
      setFfmpegReady(true)
    } catch (e) {
      setError('Erro ao carregar o processador de vídeo.')
      console.error(e)
    } finally {
      setFfmpegLoading(false)
    }
  }

  function handleAudioChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setAudioFile(file)
    setAudioName(file.name)
    setResultUrl(null)
    setError(null)
    e.target.value = ''
  }

  async function generateMeme() {
    if (!audioFile || !ffmpegReady || processing) return

    setProcessing(true)
    setProgress(0)
    setError(null)
    setResultUrl(null)

    try {
      const ffmpeg = ffmpegRef.current

      await ffmpeg.writeFile('input.mp4', await fetchFile(`${import.meta.env.BASE_URL}jurassic.mp4`))
      await ffmpeg.writeFile('useraudio', await fetchFile(audioFile))

      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-i', 'useraudio',
        '-filter_complex',
        `[0:a]volume=0:enable='between(t,${ROAR_START},${ROAR_END})'[muted];` +
        `[1:a]adelay=${Math.round(ROAR_START * 1000)}|${Math.round(ROAR_START * 1000)}[delayed];` +
        `[muted][delayed]amix=inputs=2:duration=first:normalize=0[aout]`,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        'output.mp4',
      ])

      const data = await ffmpeg.readFile('output.mp4')
      const blob = new Blob([data.buffer], { type: 'video/mp4' })
      setResultUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError('Erro ao processar o vídeo. Tente com outro arquivo de áudio.')
      console.error(e)
    } finally {
      setProcessing(false)
    }
  }

  function downloadResult() {
    if (!resultUrl) return
    const a = document.createElement('a')
    a.href = resultUrl
    a.download = 'dinosaur-meme.mp4'
    a.click()
  }

  const canGenerate = audioFile && ffmpegReady && !processing

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col items-center gap-8">

        {/* Header */}
        <header className="text-center">
          <div className="text-6xl mb-4 select-none">🦕</div>
          <h1 className="text-3xl font-black tracking-tight leading-tight">
            Qual o som do dinossauro?
          </h1>
          <p className="text-zinc-400 mt-2 text-base">
            Substitua o rugido por qualquer áudio.
          </p>
        </header>

        {/* FFmpeg loading */}
        {ffmpegLoading && (
          <div className="w-full bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 text-center text-zinc-400 text-sm animate-pulse">
            Carregando processador de vídeo...
          </div>
        )}

        {/* Original video */}
        <section className="w-full">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
            Vídeo original
          </p>
          <video
            src={`${import.meta.env.BASE_URL}jurassic.mp4`}
            controls
            className="w-full rounded-xl border border-zinc-800 shadow-2xl bg-black"
          />
        </section>

        {/* Audio upload */}
        <section className="w-full">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
            Seu áudio
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-zinc-700 hover:border-lime-500 rounded-xl p-6 flex flex-col items-center gap-2 transition-colors cursor-pointer group focus:outline-none focus:border-lime-500"
          >
            <span className="text-3xl">{audioFile ? '✅' : '🎵'}</span>
            <span className="font-semibold text-zinc-300 group-hover:text-lime-400 transition-colors text-sm">
              {audioName || 'Clique para enviar áudio'}
            </span>
            <span className="text-xs text-zinc-500">MP3, WAV, M4A ou OGG</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg"
            className="hidden"
            onChange={handleAudioChange}
          />
        </section>

        {/* Generate button */}
        <button
          type="button"
          onClick={generateMeme}
          disabled={!canGenerate}
          className={`w-full py-4 rounded-xl font-black text-xl tracking-tight transition-all duration-150
            ${canGenerate
              ? 'bg-lime-500 hover:bg-lime-400 text-black shadow-lg shadow-lime-500/25 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
        >
          {processing ? '⏳ Processando...' : '🦖 Gerar Meme'}
        </button>

        {/* Progress bar */}
        {processing && (
          <div className="w-full -mt-4">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Processando vídeo</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-lime-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="w-full bg-red-950/60 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {resultUrl && (
          <section className="w-full" ref={resultRef}>
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
              Resultado
            </p>
            <video
              src={resultUrl}
              controls
              autoPlay
              className="w-full rounded-xl border border-lime-800/50 shadow-2xl shadow-lime-500/10 bg-black"
            />
            <button
              type="button"
              onClick={downloadResult}
              className="mt-3 w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>⬇️</span>
              <span>Baixar dinosaur-meme.mp4</span>
            </button>
          </section>
        )}

      </div>
    </div>
  )
}
