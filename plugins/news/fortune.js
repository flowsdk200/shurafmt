import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'fortune',
    aliases: [],
    description: 'Fortune',
    feed: 'https://fortune.com/feed/',
})
