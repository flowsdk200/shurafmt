import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import axios from 'axios'
import ffmpegPath from 'ffmpeg-static'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Helper: hapus file jika ada, abaikan error **/
const tryUnlink = async (filePath) => {
    try { await fs.promises.unlink(filePath) } catch { /* abaikan */ }
}

async function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
    const tmpDir = path.join(__dirname, '../../tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const tmp = path.join(tmpDir, +new Date() + '.' + ext)
    const out = tmp + '.' + ext2

    await fs.promises.writeFile(tmp, buffer)

    try {
        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, ['-y', '-i', tmp, ...args, out])
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)))
        })

        const data = await fs.promises.readFile(out)
        return { data, filename: out }
    } finally {
        await tryUnlink(tmp)
        await tryUnlink(out)
    }
}

function toPTT(buffer, ext) {
    return ffmpeg(buffer, ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on'], ext, 'ogg')
}

function toAudio(buffer, ext) {
    return ffmpeg(buffer, ['-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'], ext, 'mp3')
}

function toVideo(buffer, ext) {
    return ffmpeg(buffer, ['-c:v', 'libx264', '-c:a', 'aac', '-ab', '128k', '-ar', '44100', '-crf', '32', '-preset', 'slow'], ext, 'mp4')
}

const getBuffer = async (url, options = {}) => {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000, ...options })
    return Buffer.from(res.data)
}

const getJson = async (url, options = {}) => {
    const res = await axios.get(url, { responseType: 'json', timeout: 15000, ...options })
    return res.data
}

export { toAudio, toPTT, toVideo, ffmpeg, getBuffer, getJson }
