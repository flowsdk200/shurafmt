import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'sindonews',
    aliases: ['sindo'],
    description: 'Sindo News',
    feed: 'https://www.sindonews.com/feed/',
})
