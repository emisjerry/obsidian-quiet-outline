<template>
    <div id="container">
        <NConfigProvider :theme="theme" :theme-overrides="themeConfig">
            <div class="function-bar" v-if="store.plugin.settings.search_support">
                <NButton size="small" circle @click="reset">
                    <template #icon>
                        <Icon>
                            <SettingsBackupRestoreRound :style="iconColor"/>
                        </Icon>
                    </template>
                </NButton>
                <NInput v-model:value="pattern" placeholder="Input to search" size="small" clearable />
            </div>
            <NSlider v-if="store.plugin.settings.level_switch" v-model:value="level" :marks="marks" step="mark" :min="0"
                :max="5" style="margin:4px 0;" :format-tooltip="formatTooltip" />
            <code v-if="pattern">{{matchCount}} result(s): </code>
            <NTree block-line :pattern="pattern" :data="data2" :on-update:selected-keys="jump"
                :render-label="renderMethod" :node-props="setAttrs" :expanded-keys="expanded"
                :on-update:expanded-keys="expand" :key="update_tree" :filter="filter"
                :show-irrelevant-nodes="!store.plugin.settings.hide_unsearched" 
                :class="{'ellipsis': store.plugin.settings.ellipsis}"/>
        </NConfigProvider>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, getCurrentInstance, onMounted, onUnmounted, HTMLAttributes, h } from 'vue'
import { Notice, MarkdownView, sanitizeHTMLToDom, HeadingCache, debounce } from 'obsidian'
import { NTree, TreeOption, NButton, NInput, NSlider, NConfigProvider, darkTheme, GlobalThemeOverrides } from 'naive-ui'
import { Icon } from '@vicons/utils'
import { SettingsBackupRestoreRound } from '@vicons/material'
import { marked } from 'marked'

import { formula, internal_link, highlight, tag, remove_href, renderer } from './parser'
import { store } from './store'
import { QuietOutline } from "./plugin"

const themeConfig: GlobalThemeOverrides = {
    Slider: {
        handleSize: "10px",
    }
}


onMounted(() => {
    addEventListener("quiet-outline-reset", reset)
})
onUnmounted(() => {
    removeEventListener("quiet-outline-reset", reset)
})

let compomentSelf = getCurrentInstance()
let plugin = compomentSelf.appContext.config.globalProperties.plugin as QuietOutline
let container =compomentSelf .appContext.config.globalProperties.container as HTMLElement

// register scroll event
onMounted(() => {
    document.addEventListener("scroll", handleScroll, true)
})

onUnmounted(() => {
    document.removeEventListener("scroll", handleScroll, true)
})

let toKey = (h: HeadingCache, i: number) => "item-" + h.level + "-" + i

let handleScroll = debounce(_handleScroll, 100)

function _handleScroll(evt: Event) {
    let target = evt.target as HTMLElement
    if (!target.classList.contains("markdown-preview-view") && !target.classList.contains("cm-scroller")) {
        return
    }
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)

    if(!view) return

    let current_line = view.currentMode.getScroll() + 8
    let current_heading = null;

    let i = store.headers.length
    while (--i >= 0) {
        if (store.headers[i].position.start.line <= current_line) {
            current_heading = store.headers[i]
            break
        }
    }
    if (!current_heading) {
        return
    }

    let index = i

    if (store.plugin.settings.auto_expand) {
        let should_expand = index < store.headers.length - 1 && store.headers[index].level < store.headers[index + 1].level
            ? [toKey(current_heading, index)]
            : []

        let level = current_heading.level
        while (i-- > 0) {
            if (store.headers[i].level < level) {
                should_expand.push(toKey(store.headers[i], i))
                level = store.headers[i].level
            }
            if (level === 1) {
                break
            }
        }
        expanded.value = should_expand
    }
    let prevLocation = container.querySelector(".n-tree-node.located")
    if (prevLocation) {
        prevLocation.removeClass("located")
    }
    let curLocation = container.querySelector(`#no-${index}`)
    if (curLocation) {
        curLocation.addClass("located")
        curLocation.scrollIntoView({block: "center", behavior: "smooth"})
    } else {
        setTimeout(() => {
            let curLocation = container.querySelector(`#no-${index}`)
            if (curLocation) {
                curLocation.addClass("located")
                curLocation.scrollIntoView({block: "center", behavior: "smooth"})
            }
        },0)
    }
}


// add html attributes to nodes
function setAttrs(info: { option: TreeOption }): HTMLAttributes {
    let lev = parseInt((info.option.key as string).split('-')[1])
    let no = parseInt((info.option.key as string).split('-')[2])

    return {
        class: `level-${lev}`,
        id: `no-${no}`,
        title: plugin.settings.ellipsis? info.option.label: "",
    }
}

// switch heading expand levels
let level = ref(parseInt(store.plugin.settings.expand_level));
let expanded = ref<string[]>([])
switchLevel(level.value);

function expand(keys: string[], option: TreeOption[]) {
    expanded.value = keys;
}

function switchLevel(lev: number) {
    expanded.value = store.headers
        .map((h, i) => {
            return "item-" + h.level + "-" + i
        })
        .filter((key, i, arr) => {
            const get_level = (k: string): number => parseInt(k.split('-')[1])
            if (i === arr.length - 1) return false
            if (get_level(arr[i]) >= get_level(arr[i + 1])) return false
            return get_level(key) <= lev
        })
}

watch(
    level,
    (cur, prev) => {
        switchLevel(cur)
    }
)

// force remake tree
let update_tree = ref(0)

watch(
    () => store.leaf_change,
    () => {
        const old_level = level.value
        const old_pattern = pattern.value

        pattern.value = ""
        level.value = parseInt(store.plugin.settings.expand_level)
        if (old_level === level.value) {
            switchLevel(level.value)
        }
        
        nextTick(() => {
            pattern.value = old_pattern
        })

    }
)

const marks = {
    0: "",
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
}

function formatTooltip(value: number): string {
    let num = store.headers.filter((h) => h.level === value).length

    if (value > 0) {
        return `H${value}: ${num}`
    }
    return "No expand"
}


// load settings
let renderMethod = computed(() => {
    if (store.plugin.settings.markdown) {
        return renderLabel
    }
    return null
})

// search
let pattern = ref("")

function regexFilter(pattern: string, option: TreeOption) : boolean {
    let rule = RegExp(pattern, "i")
    return rule.test(option.label)
}

function simpleFilter(pattern: string, option: TreeOption) : boolean {
    return option.label.toLowerCase().contains(pattern.toLowerCase())
}

let filter = computed(() => {
    return store.plugin.settings.regex_search ? regexFilter: simpleFilter
}) 

let matchCount = computed(() => {
    return store.headers.filter((h) => {
        let node = {label: h.heading} as TreeOption
        return filter.value(pattern.value, node)
    }).length
})


// toggle light/dark theme
let theme: any = computed(() => {
    if (store.dark) {
        return darkTheme
    }
    return null
})
let iconColor = computed(() => {
    if(store.dark) {
        return {color: "#a3a3a3"}
    }
    return {color: "#727272"}
})

// click and jump
async function jump(_selected: any, nodes: TreeOption[]): Promise<number> {
    if (nodes[0] === undefined) {
        return
    }

    const key_value = (nodes[0].key as string).split("-")
    const key = parseInt(key_value[2])
    let line: number = store.headers[key].position.start.line

    // const view = store.plugin.app.workspace.getActiveViewOfType(MarkdownView)
    const view = plugin.current_note
    if (view) {
        view.setEphemeralState({ line })
        setTimeout(() => { view.setEphemeralState({ line }) }, 100)
    }
}

// prepare data for tree component
let data2 = computed(() => {
    return makeTree(store.headers)
})

function makeTree(headers: HeadingCache[]): TreeOption[] {

    let tree: TreeOption[] = arrToTree(headers)
    return tree
}

function arrToTree(headers: HeadingCache[]): TreeOption[] {
    const root: TreeOption = { children: [] }
    const stack = [{ node: root, level: -1 }]

    headers.forEach((h, i) => {
        let node: TreeOption = {
            label: h.heading,
            key: "item-" + h.level + "-" + i,
            line: h.position.start.line,
        }

        while (h.level <= stack.last().level) {
            stack.pop()
        }

        let parent = stack.last().node
        if (parent.children === undefined) {
            parent.children = []
        }
        parent.children.push(node)
        stack.push({ node, level: h.level })
    })

    return root.children
}


// render markdown
marked.use({ extensions: [formula, internal_link, highlight, tag] })
marked.use({ walkTokens: remove_href })
marked.use({ renderer })

function renderLabel({ option }: { option: TreeOption }) {
    let result = marked.parse(option.label).trim()

    // save mjx elements
    let i = 0
    let mjxes = result.match(/<mjx-container.*?>.*?<\/mjx-container>/g)

    result = sanitizeHTMLToDom(`<div>${result}</div>`).children[0].innerHTML

    // restore mjx elements
    result = result.replace(/<math.*?>.*?<\/math>/g, () => {
        return mjxes[i++]
    })
    
    return h("div", {innerHTML: result})
}

// reset button
function reset() {
    store.dark = document.querySelector('body').classList.contains('theme-dark')
    pattern.value = ""
    level.value = parseInt(store.plugin.settings.expand_level)
    switchLevel(level.value)
}


// sync with markdown
// watch(expanded, (ex) => {
//     let expandedIndex = expanded.value.map(key =>parseInt(key.split("-")[2]))
//     let folds: {from: number, to: number}[] = []
//     store.headers.forEach((h, i) => {
//         if(!expandedIndex.contains(i)) {
//             let from = h.position.start.line
//             folds.push({
//                 from,
//                 to: from + 1,
//             })
//         }
//     })
    
//     let mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView)
    
//     if(mdView && plugin.settings.sync_with_markdown === "bidirectional") {
//         (mdView.currentMode as any).applyFoldInfo({
//             folds,
//             lines: mdView.editor.lineCount()
//         })
//     }
// })


</script>


<style>
</style>
