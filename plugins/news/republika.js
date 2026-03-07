import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'republika',
    aliases: ['republiknews'],
    description: 'Republika News',
    path: 'republika-news',
    categories: ['news', 'nusantara', 'khazanah', 'islam-digest', 'internasional', 'ekonomi', 'sepakbola', 'leisure'],
})
