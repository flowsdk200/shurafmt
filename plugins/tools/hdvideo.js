import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { downloadContentFromMessage } from 'baileys'
import ffmpegPath from 'ffmpeg-static'

const cleanText = (value) => String(value || '').trim()

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const extFromMime = (mime = '') => {
    const m = cleanText(mime).toLowerCase()
    if (m.includes('quicktime')) return 'mov'
    if (m.includes('x-matroska')) return 'mkv'
    if (m.includes('webm')) return 'webm'
    if (m.includes('3gpp')) return '3gp'
    return 'mp4'
}

const convertHdVideo = async (buffer, ext = 'mp4') => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdvideo-'))
    const input = path.join(tmpDir, `input.${ext}`)
    const output = path.join(tmpDir, 'output.mp4')

    await fs.promises.writeFile(input, buffer)

    const vf = [
        'scale=trunc(iw*1.5/2)*2:trunc(ih*1.5/2)*2:flags=lanczos',
        'unsharp=5:5:0.8:3:3:0.4',
        'eq=contrast=1.04:saturation=1.08:brightness=0.01'
    ].join(',')

    const args = [
        '-y',
        '-i', input,
        '-map_metadata', '-1',
        '-vf', vf,
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-level', '4.0',
        '-preset', 'medium',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        output
    ]

    try {
        await new Promise((resolve, reject) => {
            const ff = spawn(ffmpegPath, args)
            let stderr = ''

            ff.stderr.on('data', (d) => { stderr += d.toString() })
            ff.on('error', reject)
            ff.on('close', (code) => {
                if (code === 0) return resolve()
                reject(new Error(cleanText(stderr) || `ffmpeg exited with code ${code}`))
            })
        })

        return await fs.promises.readFile(output)
    } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
}

const pickVideoSource = ({ msg, isQuoted, quotedMsg, quotedType }) => {
    if (isQuoted && quotedType === 'videoMessage' && quotedMsg?.videoMessage) {
        return { media: quotedMsg.videoMessage, source: 'reply' }
    }

    if (msg?.message?.videoMessage) {
        return { media: msg.message.videoMessage, source: 'self' }
    }

    return null
}

export default {
    name: 'hdvideo',
    aliases: ['hdvid', 'videohd', 'enhancevideo'],
    description: 'Tingkatkan kualitas video ke HD (ffmpeg static)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const source = pickVideoSource({ msg, isQuoted, quotedMsg, quotedType })

        if (!source?.media) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply video dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(source.media, 'video')
            const buffer = await streamToBuffer(stream)
            if (!buffer?.length) throw new Error('Gagal download video input')

            const ext = extFromMime(source.media?.mimetype)
            const hdVideo = await convertHdVideo(buffer, ext)
            if (!hdVideo?.length) throw new Error('Gagal proses video HD')

            await sock.sendMessage(jid, {
                video: hdVideo,
                mimetype: 'video/mp4',
                caption: '```✅ HDVIDEO DONE```'
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal proses HD video'}`
            }, { quoted: msg })
        }
    }
}
