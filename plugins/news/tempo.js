import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'tempo',
    aliases: ['temponews'],
    description: 'Tempo News',
    path: 'tempo-news',
    categories: ['nasional', 'bisnis', 'metro', 'dunia', 'bola', 'sport', 'cantik', 'tekno', 'otomotif', 'nusantara'],
})
