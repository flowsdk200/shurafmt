import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import Crypto from 'crypto'
import { spawn } from 'child_process'
import { fileTypeFromBuffer } from 'file-type'
import webp from 'node-webpmux'
import ffmpegPath from 'ffmpeg-static'

/** Helper: hapus file jika ada, abaikan error **/
const tryUnlink = (filePath) => {
    try { fs.unlinkSync(filePath) } catch { /* abaikan */ }
}

async function imageToWebp(media) {
    const tmpOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`)
    const tmpIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.jpg`)
    fs.writeFileSync(tmpIn, media)
    try {
        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, ['-i', tmpIn, '-vcodec', 'libwebp', '-vf',
                "scale=320:320:force_original_aspect_ratio=increase:flags=lanczos,crop=320:320,fps=15,split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse",
                tmpOut])
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`ffmpeg exited with code ${code}`)))
        })
        const buff = fs.readFileSync(tmpOut)
        return buff
    } finally {
        tryUnlink(tmpIn)
        tryUnlink(tmpOut)
    }
}

async function videoToWebp(media) {
    const tmpOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`)
    const tmpIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.mp4`)
    fs.writeFileSync(tmpIn, media)
    try {
        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, ['-i', tmpIn, '-vcodec', 'libwebp', '-vf',
                "scale=320:320:force_original_aspect_ratio=increase:flags=lanczos,crop=320:320,fps=15,split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse",
                '-loop', '0', '-ss', '00:00:00', '-t', '00:00:05', '-preset', 'default', '-an', '-vsync', '0', tmpOut])
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`ffmpeg exited with code ${code}`)))
        })
        const buff = fs.readFileSync(tmpOut)
        return buff
    } finally {
        tryUnlink(tmpIn)
        tryUnlink(tmpOut)
    }
}

async function writeExif(media, data) {
    const fileType = await fileTypeFromBuffer(media)
    const wMedia = /webp/.test(fileType.mime) ? media
        : /image/.test(fileType.mime) ? await imageToWebp(media)
            : /video/.test(fileType.mime) ? await videoToWebp(media)
                : null

    if (!wMedia) throw new Error(`Tipe file tidak didukung: ${fileType.mime}`)

    const tmpIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`)
    const tmpOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`)
    fs.writeFileSync(tmpIn, wMedia)

    if (data) {
        try {
            const img = new webp.Image()
            const json = {
                'sticker-pack-id': 'sfmt-' + Crypto.randomBytes(8).toString('hex'),
                'sticker-pack-name': data.packname || 'shurafmt',
                emojis: data.categories || [''],
                'is-avatar-sticker': 0
            }
            const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
            const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8')
            const exif = Buffer.concat([exifAttr, jsonBuff])
            exif.writeUIntLE(jsonBuff.length, 14, 4)
            await img.load(tmpIn)
            img.exif = exif
            await img.save(tmpOut)
            tryUnlink(tmpIn)
            return tmpOut
        } catch (e) {
            tryUnlink(tmpIn)
            tryUnlink(tmpOut)
            throw e
        }
    } else {
        /** Tidak ada data EXIF — kembalikan tmpIn as-is (plain WebP) **/
        return tmpIn
    }
}

const makeSticker = async (sock, jid, buffer, { packname = 'shurafmt', quoted } = {}) => {
    const stickerPath = await writeExif(buffer, { packname })
    try {
        await sock.sendMessage(jid, { sticker: { url: stickerPath } }, { quoted })
    } finally {
        tryUnlink(stickerPath)
    }
}

export { imageToWebp, videoToWebp, writeExif, makeSticker }
