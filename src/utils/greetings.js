import { createRequire } from 'module'
import { normalizeJid } from './jid.js'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

export const formatJoinedAt = () => {
    return new Date().toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

export const buildWelcomeMessage = ({ userJid, groupSubject, memberInfo }) => {
    const tag = `@${String(userJid || '').split('@')[0]}`
    const subject = groupSubject;
    return (
        `Hii ${tag} welcome to ${subject}.\n\n` +
        `• Time: ${formatJoinedAt()}\n` +
        `• Members: ${memberInfo.previous} ➠ ${memberInfo.current} (+1)`
    )
}

export const buildGoodbyeMessage = ({ userJid, groupSubject, memberInfo }) => {
    const tag = `@${String(userJid || '').split('@')[0]}`
    const subject = groupSubject;
    return (
        `${tag} has left the group ${subject}.\n\n` +
        `• Time: ${formatJoinedAt()}\n` +
        `• Members: ${memberInfo.previous} ➠ ${memberInfo.current} (-1)`
    )
}

const resizeTo200 = async (buf) => {
    try {
        const img = await Jimp.fromBuffer(buf)
        img.resize({ w: 200, h: 200 })
        return await img.getBuffer('image/jpeg')
    } catch {
        return buf
    }
}

const resolveParticipantJid = (participant, groupMetadata) => {
    const participantJid = typeof participant === 'string'
        ? participant
        : (participant?.id || participant?.jid || participant?.participant || '')
    if (!participantJid) return ''

    let userJid = normalizeJid(participantJid) || participantJid
    if (userJid.endsWith('@lid') && Array.isArray(groupMetadata?.participants)) {
        const match = groupMetadata.participants.find((x) => x?.id === participantJid)
        if (match?.phoneNumber?.endsWith('@s.whatsapp.net')) {
            userJid = match.phoneNumber
        }
    }

    return userJid
}

const getProfilePictureBuffer = async (sock, targetJid, fallbackBuffer) => {
    try {
        const url = await sock.profilePictureUrl(targetJid, 'image')
        if (!url) return await resizeTo200(fallbackBuffer)
        const res = await fetch(url)
        if (!res.ok) return await resizeTo200(fallbackBuffer)
        const raw = Buffer.from(await res.arrayBuffer())
        return await resizeTo200(raw)
    } catch {
        return await resizeTo200(fallbackBuffer)
    }
}

export const sendGreetingMessage = async ({
    sock,
    config,
    groupId,
    participant,
    groupMetadata,
    isWelcome,
}) => {
    const userJid = resolveParticipantJid(participant, groupMetadata)
    if (!userJid) return

    const totalMembersRaw = Number(groupMetadata?.size ?? groupMetadata?.participants?.length)
    const hasTotal = Number.isFinite(totalMembersRaw)
    const memberInfo = {
        current: hasTotal ? String(totalMembersRaw) : '-',
        previous: hasTotal
            ? String(isWelcome ? Math.max(0, totalMembersRaw - 1) : totalMembersRaw + 1)
            : '-'
    }

    const text = isWelcome
        ? buildWelcomeMessage({ userJid, groupSubject: groupMetadata?.subject || groupId, memberInfo })
        : buildGoodbyeMessage({ userJid, groupSubject: groupMetadata?.subject || groupId, memberInfo })

    const mentions = userJid.endsWith('@s.whatsapp.net') ? [userJid] : []
    const profilePicture = await getProfilePictureBuffer(sock, userJid, config.thumb)
    const fileName = isWelcome ? '👋 WELCOME' : '👋 GOODBYE'

    await sock.sendMessage(groupId, {
        document: profilePicture,
        mimetype: 'image/png',
        fileName,
        fileLength: 999999,
        pageCount: 0,
        jpegThumbnail: profilePicture,
        caption: text,
        contextInfo: {
            mentionedJid: mentions
        }
    })
}
