import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { downloadContentFromMessage } from 'baileys'
import ffmpegPath from 'ffmpeg-static'
import webp from 'node-webpmux'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const toVideoFromAnimatedSticker = async (buffer) => {
    await webp.Image.initLib()

    const img = new webp.Image()
    await img.load(buffer)
    const frames = await img.demux({ buffers: true })
    if (!frames?.length) throw new Error('Frame animasi tidak ditemukan')

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stk2vid-'))
    const out = path.join(tmpDir, 'out.mp4')

    try {
        const maxFrames = Math.min(frames.length, 180)
        for (let i = 0; i < maxFrames; i++) {
            const file = path.join(tmpDir, `frame_${String(i).padStart(4, '0')}.webp`)
            await fs.promises.writeFile(file, Buffer.from(frames[i]))
        }

        const args = [
            '-y',
            '-framerate', '15',
            '-i', path.join(tmpDir, 'frame_%04d.webp'),
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
            '-movflags', '+faststart',
            out
        ]

        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, args)
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)))
        })

        return fs.promises.readFile(out)
    } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
}

export default {
    name: 'tovideo',
    aliases: ['tovid'],
    description: 'Convert sticker animasi ke video',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || quotedType !== 'stickerMessage') {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply sticker animasi dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        const media = quotedMsg.stickerMessage
        if (!media?.isAnimated) {
            return sock.sendMessage(jid, {
                text: '❌ Command ini hanya untuk sticker animasi.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(media, 'sticker')
            const buffer = await streamToBuffer(stream)
            const video = await toVideoFromAnimatedSticker(buffer)

            await sock.sendMessage(jid, {
                video,
                mimetype: 'video/mp4'
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
