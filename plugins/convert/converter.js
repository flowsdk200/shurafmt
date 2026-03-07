import { downloadContentFromMessage } from 'baileys'
import { ffmpeg } from '../../src/utils/converter.js'

const AUDIO_FILTERS = {
    bass: ['-af', 'equalizer=f=54:width_type=o:width=2:g=20'],
    blown: ['-af', 'acrusher=.1:1:64:0:log'],
    deep: ['-af', 'atempo=4/4,asetrate=44500*2/3'],
    earrape: ['-af', 'volume=12'],
    fast: ['-filter:a', 'atempo=1.63,asetrate=44100'],
    fat: ['-filter:a', 'atempo=1.6,asetrate=22100'],
    nightcore: ['-filter:a', 'atempo=1.06,asetrate=44100*1.25'],
    reverse: ['-filter_complex', 'areverse'],
    robot: ['-filter_complex', "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"],
    slow: ['-filter:a', 'atempo=0.7,asetrate=44100'],
    squirrel: ['-filter:a', 'atempo=0.5,asetrate=65100']
}

const VIDEO_FILTERS = {
    smooth: ['-filter:v', "minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120'"]
}

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'bass',
    aliases: ['blown', 'deep', 'earrape', 'fast', 'fat', 'nightcore', 'reverse', 'robot', 'slow', 'smooth', 'squirrel'],
    description: 'Audio/video effect converter',
    execute: async ({ sock, msg, command, isQuoted, quotedMsg, quotedType, quotedMimetype, prefix, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const cmd = String(command || '').toLowerCase()

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, {
                text: `❌ Reply media dulu.\n\nContoh:\n- ${prefix + cmd}`
            }, { quoted: msg })
        }

        const media = quotedMsg[quotedType]
        if (!media) {
            return sock.sendMessage(jid, { text: '❌ Media reply tidak valid.' }, { quoted: msg })
        }

        const isAudioEffect = Object.prototype.hasOwnProperty.call(AUDIO_FILTERS, cmd)
        const isVideoEffect = Object.prototype.hasOwnProperty.call(VIDEO_FILTERS, cmd)

        if (!isAudioEffect && !isVideoEffect) {
            return sock.sendMessage(jid, { text: '❌ Invalid command.' }, { quoted: msg })
        }

        if (isAudioEffect && !['audioMessage', 'videoMessage'].includes(quotedType)) {
            return sock.sendMessage(jid, {
                text: `❌ Gunakan dengan cara reply audio/video + ${prefix + cmd}`
            }, { quoted: msg })
        }

        if (isVideoEffect && quotedType !== 'videoMessage') {
            return sock.sendMessage(jid, {
                text: `❌ Media yang di reply harus video.`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const mediaType = quotedType.replace('Message', '')
            const stream = await downloadContentFromMessage(media, mediaType)
            const buffer = await streamToBuffer(stream)

            if (isAudioEffect) {
                const ext = quotedType === 'audioMessage'
                    ? (String(quotedMimetype || '').includes('ogg') ? 'ogg' : 'mp3')
                    : 'mp4'
                const converted = await ffmpeg(buffer, [...AUDIO_FILTERS[cmd], '-f', 'mp3'], ext, 'mp3')
                if (!converted?.data) throw new Error('Gagal convert audio')

                await sock.sendMessage(jid, {
                    audio: converted.data,
                    mimetype: 'audio/mpeg'
                }, { quoted: msg })
            } else {
                const converted = await ffmpeg(buffer, [...VIDEO_FILTERS[cmd], '-c:v', 'libx264', '-c:a', 'aac'], 'mp4', 'mp4')
                if (!converted?.data) throw new Error('Gagal convert video')

                await sock.sendMessage(jid, {
                    video: converted.data,
                    mimetype: 'video/mp4'
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal convert: ${err.message}`
            }, { quoted: msg })
        }
    }
}
