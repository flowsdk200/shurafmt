import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'cnbc',
    aliases: ['cnbcnews', 'berita-cnbc'],
    description: 'CNBC News',
    path: 'cnbc-news',
    categories: ['market', 'news', 'entrepreneur', 'syariah', 'tech', 'lifestyle'],
})
