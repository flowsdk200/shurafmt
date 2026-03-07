import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'antara',
    aliases: ['antaranews'],
    description: 'Antara News',
    path: 'antara-news',
    requiresType: true,
    categories: ['terkini', 'top-news', 'politik', 'hukum', 'ekonomi', 'metro', 'sepakbola', 'olahraga', 'humaniora', 'lifestyle', 'hiburan', 'dunia', 'infografik', 'tekno', 'otomotif', 'warta-bumi', 'rilis-pers'],
})
