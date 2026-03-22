import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'okezone',
    aliases: ['okezone', 'okezonnews'],
    description: 'Okezone News',
    path: 'okezone-news',
    requiresType: true,
    categories: ['breaking', 'sport', 'economy', 'lifestyle', 'celebrity', 'bola', 'techno'],
})
