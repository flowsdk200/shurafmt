import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'dw',
    aliases: ['deutschewelle'],
    description: 'Deutsche Welle',
    feed: 'https://rss.dw.com/xml/rss-en-all',
})
