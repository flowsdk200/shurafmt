import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'voa',
    aliases: ['voa-news', 'berita-voa'],
    description: 'VOA Indonesia',
    path: 'voa-news',
})
