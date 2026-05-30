import { useRef, useState, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ROAR_START = 29.3
const ROAR_END = 36

export default function App() {
  const ffmpegRef = useRef(new FFmpeg())
  const fileInputRef = useRef(null)
  const videoFileInputRef = useRef(null)
  const resultRef = useRef(null)
  const audioUrlRef = useRef(null)
  const videoUrlRef = useRef(null)

  const [ffmpegReady, setFfmpegReady] = useState(false)
  const [ffmpegLoading, setFfmpegLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultUrl, setResultUrl] = useState(null)
  const [error, setError] = useState(null)

  // Mode: 'audio' | 'video'
  const [inputMode, setInputMode] = useState('audio')

  // Audio mode
  const [audioFile, setAudioFile] = useState(null)
  const [audioName, setAudioName] = useState('')
  const [audioObjectUrl, setAudioObjectUrl] = useState(null)
  const [audioDuration, setAudioDuration] = useState(null)
  const [audioStart, setAudioStart] = useState(0)
  const [audioEnd, setAudioEnd] = useState(null)
  const [audioTrimConfirmed, setAudioTrimConfirmed] = useState(false)

  // Video mode — uploaded video
  const [videoFile, setVideoFile] = useState(null)
  const [videoName, setVideoName] = useState('')
  const [videoObjectUrl, setVideoObjectUrl] = useState(null)
  const [userVideoDuration, setUserVideoDuration] = useState(null)
  // Intro clip trim
  const [userVidStart, setUserVidStart] = useState(0)
  const [userVidEnd, setUserVidEnd] = useState(null)
  // Roar replacement audio trim (from the uploaded video's audio track)
  const [vidAudioStart, setVidAudioStart] = useState(0)
  const [vidAudioEnd, setVidAudioEnd] = useState(null)

  // Jurassic video trim
  const [videoStart, setVideoStart] = useState(26)
  const [videoEnd, setVideoEnd] = useState(33)

  // Export format
  const [exportFormat, setExportFormat] = useState('horizontal')

  useEffect(() => { loadFFmpeg() }, [])

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

    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    audioUrlRef.current = objectUrl

    setAudioFile(file)
    setAudioName(file.name)
    setAudioObjectUrl(objectUrl)
    setResultUrl(null)
    setError(null)
    setAudioStart(0)
    setAudioTrimConfirmed(false)

    const tempAudio = new Audio()
    tempAudio.src = objectUrl
    tempAudio.onloadedmetadata = () => {
      setAudioDuration(tempAudio.duration)
      setAudioEnd(tempAudio.duration)
    }

    e.target.value = ''
  }

  function handleVideoChange(e) {
    const file = e.target.files[0]
    if (!file) return

    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    videoUrlRef.current = objectUrl

    setVideoFile(file)
    setVideoName(file.name)
    setVideoObjectUrl(objectUrl)
    setResultUrl(null)
    setError(null)
    setUserVidStart(0)
    setVidAudioStart(0)

    const tempVid = document.createElement('video')
    tempVid.src = objectUrl
    tempVid.onloadedmetadata = () => {
      setUserVideoDuration(tempVid.duration)
      setUserVidEnd(tempVid.duration)
      setVidAudioEnd(tempVid.duration)
    }

    e.target.value = ''
  }

  function switchMode(mode) {
    if (mode === inputMode) return
    setInputMode(mode)
    setResultUrl(null)
    setError(null)
  }

  async function generateMeme() {
    if (!ffmpegReady || processing) return
    if (inputMode === 'audio' && !audioFile) return
    if (inputMode === 'video' && !videoFile) return

    setProcessing(true)
    setProgress(0)
    setError(null)
    setResultUrl(null)

    try {
      const ffmpeg = ffmpegRef.current

      await ffmpeg.writeFile('input.mp4', await fetchFile(`${import.meta.env.BASE_URL}jurassic.mp4`))

      const relMuteStart = Math.max(0, ROAR_START - videoStart)
      const relMuteEnd = Math.min(ROAR_END - videoStart, videoEnd - videoStart)
      const relDelay = Math.round(Math.max(0, (ROAR_START - videoStart) * 1000))

      if (inputMode === 'audio') {
        await ffmpeg.writeFile('useraudio', await fetchFile(audioFile))

        const effectiveAudioEnd = audioEnd ?? audioDuration
        const useAudioTrim = audioStart > 0 || (effectiveAudioEnd !== null && audioDuration !== null && effectiveAudioEnd < audioDuration - 0.05)

        const filterParts = []

        filterParts.push(`[0:v]trim=start=${videoStart}:end=${videoEnd},setpts=PTS-STARTPTS[trimv]`)
        filterParts.push(`[0:a]atrim=start=${videoStart}:end=${videoEnd},asetpts=PTS-STARTPTS,volume=0:enable='between(t,${relMuteStart},${relMuteEnd})'[muted]`)

        if (useAudioTrim) {
          filterParts.push(`[1:a]atrim=start=${audioStart}:end=${effectiveAudioEnd},asetpts=PTS-STARTPTS[ua]`)
          filterParts.push(`[ua]adelay=${relDelay}|${relDelay}[delayed]`)
        } else {
          filterParts.push(`[1:a]adelay=${relDelay}|${relDelay}[delayed]`)
        }

        filterParts.push(`[muted][delayed]amix=inputs=2:duration=first:normalize=0[aout]`)

        if (exportFormat === 'instagram') {
          filterParts.push(`[trimv]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[vout]`)
        }

        const filterComplex = filterParts.join(';')
        const videoMap = exportFormat === 'instagram' ? '[vout]' : '[trimv]'

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-i', 'useraudio',
          '-filter_complex', filterComplex,
          '-map', videoMap,
          '-map', '[aout]',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-c:a', 'aac',
          'output.mp4',
        ])
      } else {
        // Video mode
        // [0] = jurassic.mp4, [1] = user's video
        await ffmpeg.writeFile('uservideo', await fetchFile(videoFile))

        const effectiveUserVidEnd = userVidEnd ?? userVideoDuration
        const effectiveVidAudioEnd = vidAudioEnd ?? userVideoDuration

        const filterParts = []

        // Split user video audio: one for intro playback, one for roar replacement
        filterParts.push(`[1:a]asplit=2[ua_split1][ua_split2]`)

        // Intro video clip
        filterParts.push(`[1:v]trim=start=${userVidStart}:end=${effectiveUserVidEnd},setpts=PTS-STARTPTS[uvid]`)
        filterParts.push(`[ua_split1]atrim=start=${userVidStart}:end=${effectiveUserVidEnd},asetpts=PTS-STARTPTS[ua_intro]`)

        // Roar replacement audio (trimmed segment from uploaded video)
        filterParts.push(`[ua_split2]atrim=start=${vidAudioStart}:end=${effectiveVidAudioEnd},asetpts=PTS-STARTPTS[ua_roar]`)

        // Jurassic clip with muted roar
        filterParts.push(`[0:v]trim=start=${videoStart}:end=${videoEnd},setpts=PTS-STARTPTS[jv]`)
        filterParts.push(`[0:a]atrim=start=${videoStart}:end=${videoEnd},asetpts=PTS-STARTPTS,volume=0:enable='between(t,${relMuteStart},${relMuteEnd})'[jmuted]`)

        // Delay roar audio and mix with muted jurassic audio
        filterParts.push(`[ua_roar]adelay=${relDelay}|${relDelay}[delayed_roar]`)
        filterParts.push(`[jmuted][delayed_roar]amix=inputs=2:duration=first:normalize=0[jout_audio]`)

        // Concatenate: intro clip → jurassic clip
        // concat takes: [v1][a1][v2][a2] → [vout][aout]
        if (exportFormat === 'instagram') {
          filterParts.push(`[uvid]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[uvid_s]`)
          filterParts.push(`[jv]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[jv_s]`)
          filterParts.push(`[uvid_s][ua_intro][jv_s][jout_audio]concat=n=2:v=1:a=1[vout][aout]`)
        } else {
          filterParts.push(`[uvid][ua_intro][jv][jout_audio]concat=n=2:v=1:a=1[vout][aout]`)
        }

        const filterComplex = filterParts.join(';')

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-i', 'uservideo',
          '-filter_complex', filterComplex,
          '-map', '[vout]',
          '-map', '[aout]',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-c:a', 'aac',
          'output.mp4',
        ])
      }

      const data = await ffmpeg.readFile('output.mp4')
      const blob = new Blob([data.buffer], { type: 'video/mp4' })
      setResultUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError('Erro ao processar o vídeo. Tente com outro arquivo.')
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

  const needsTrimConfirm = inputMode === 'audio' && audioDuration > 9 && !audioTrimConfirmed
  const canGenerate = ffmpegReady && !processing && !needsTrimConfirm &&
    (inputMode === 'audio' ? !!audioFile : !!videoFile)

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
          <p className="mt-2 text-xs text-zinc-500">
            Fonte:{' '}
            <a
              href="https://www.youtube.com/watch?v=fnY2KL4E8LA"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-300 transition-colors"
            >
              T-Rex Jurassic World
            </a>
          </p>
        </section>

        {/* Jurassic video trim */}
        <section className="w-full">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
            Trecho do vídeo
          </p>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">Início (s)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={videoStart}
                onChange={e => setVideoStart(Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">Fim (s)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={videoEnd}
                onChange={e => setVideoEnd(Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
              />
            </div>
          </div>
        </section>

        {/* Mode selector + upload section */}
        <section className="w-full">

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => switchMode('audio')}
              className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-all duration-150 cursor-pointer
                ${inputMode === 'audio'
                  ? 'border-lime-500 bg-lime-500/10 text-lime-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500'
                }`}
            >
              🎵 Áudio
            </button>
            <button
              type="button"
              onClick={() => switchMode('video')}
              className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-all duration-150 cursor-pointer
                ${inputMode === 'video'
                  ? 'border-lime-500 bg-lime-500/10 text-lime-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500'
                }`}
            >
              🎬 Vídeo
            </button>
          </div>

          {inputMode === 'audio' ? (
            <>
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

              {audioObjectUrl && (
                <audio controls src={audioObjectUrl} className="w-full mt-3 rounded-lg" />
              )}

              {audioFile && audioDuration !== null && (
                <div className="mt-3">
                  {audioDuration > 9 && (
                    <div className="mb-3 bg-amber-950/60 border border-amber-800 rounded-xl px-4 py-3 text-amber-300 text-sm">
                      Áudio com mais de 9s — defina o trecho a usar.
                    </div>
                  )}
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-400 mb-1">Início do áudio (s)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={audioStart}
                        onChange={e => {
                          setAudioStart(Number(e.target.value))
                          setAudioTrimConfirmed(true)
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-400 mb-1">Fim do áudio (s)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={audioEnd ?? ''}
                        onChange={e => {
                          setAudioEnd(Number(e.target.value))
                          setAudioTrimConfirmed(true)
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">
                    Duração detectada: {audioDuration.toFixed(1)}s
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
                Seu vídeo
              </p>
              <button
                type="button"
                onClick={() => videoFileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-zinc-700 hover:border-lime-500 rounded-xl p-6 flex flex-col items-center gap-2 transition-colors cursor-pointer group focus:outline-none focus:border-lime-500"
              >
                <span className="text-3xl">{videoFile ? '✅' : '🎬'}</span>
                <span className="font-semibold text-zinc-300 group-hover:text-lime-400 transition-colors text-sm">
                  {videoName || 'Clique para enviar vídeo'}
                </span>
                <span className="text-xs text-zinc-500">MP4, MOV, WebM ou AVI</span>
              </button>
              <input
                ref={videoFileInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.webm,.avi"
                className="hidden"
                onChange={handleVideoChange}
              />

              {videoObjectUrl && (
                <video
                  controls
                  src={videoObjectUrl}
                  className="w-full mt-3 rounded-xl border border-zinc-800 bg-black"
                />
              )}

              {videoFile && userVideoDuration !== null && (
                <>
                  {/* Intro clip trim */}
                  <div className="mt-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
                      Trecho de introdução
                    </p>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-400 mb-1">Início (s)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={userVidStart}
                          onChange={e => setUserVidStart(Number(e.target.value))}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-400 mb-1">Fim (s)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={userVidEnd ?? ''}
                          onChange={e => setUserVidEnd(Number(e.target.value))}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">
                      Duração do vídeo: {userVideoDuration.toFixed(1)}s
                    </p>
                  </div>

                  {/* Roar replacement audio trim */}
                  <div className="mt-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
                      Áudio para o rugido
                    </p>
                    <p className="text-xs text-zinc-500 mb-2">
                      Trecho do áudio do vídeo que substituirá o rugido.
                    </p>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-400 mb-1">Início (s)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={vidAudioStart}
                          onChange={e => setVidAudioStart(Number(e.target.value))}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-400 mb-1">Fim (s)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={vidAudioEnd ?? ''}
                          onChange={e => setVidAudioEnd(Number(e.target.value))}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">
                      Duração do vídeo: {userVideoDuration.toFixed(1)}s
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {/* Export format */}
        <section className="w-full">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 font-semibold">
            Formato de exportação
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setExportFormat('horizontal')}
              className={`flex-1 py-3 rounded-xl border font-semibold text-sm transition-all duration-150 cursor-pointer
                ${exportFormat === 'horizontal'
                  ? 'border-lime-500 bg-lime-500/10 text-lime-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500'
                }`}
            >
              🖥️ Horizontal (1920×1080)
            </button>
            <button
              type="button"
              onClick={() => setExportFormat('instagram')}
              className={`flex-1 py-3 rounded-xl border font-semibold text-sm transition-all duration-150 cursor-pointer
                ${exportFormat === 'instagram'
                  ? 'border-lime-500 bg-lime-500/10 text-lime-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500'
                }`}
            >
              📱 Instagram (1080×1920)
            </button>
          </div>
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
