import { reactive } from 'vue'
import { HeadingCache, MarkdownView } from 'obsidian'
import { QuietOutline } from './plugin'


const store = reactive({
    plugin: undefined as QuietOutline,

    activeView() {
        this.plugin.activateView()
        this.refreshTree()
    },

    headers: [] as HeadingCache[],
    dark: document.body.hasClass("theme-dark"),

    leaf_change: false,
    refreshTree() {
        this.leaf_change = !this.leaf_change
    },

    current_note: null as MarkdownView
})

export { store }