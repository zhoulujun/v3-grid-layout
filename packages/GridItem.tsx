import {
  computed,
  defineComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRef,
  watch
} from 'vue'
import type { Interactable } from '@interactjs/core/Interactable'
import interact from 'interactjs'
import {
  colNumKey,
  containerWidthKey,
  eventBusKey,
  isDraggableKey,
  isMirroredKey,
  isResizableKey,
  marginKey,
  maxRowsKey,
  rowHeightKey,
  setTopLeft,
  setTopRight,
  setTransform,
  setTransformRtl,
  useCssTransformsKey
} from './helpers/utils'
import { createCoreData, getControlPosition } from './helpers/draggable-utils'
import { Emitter, EventType } from 'mitt'
import './GridItem.css'
import { propsGridItem as props } from './props'

export default defineComponent({
  name: 'GridItem',
  props,
  emits: ['container-resized', 'resize', 'resized', 'move', 'moved'],
  setup(props, { emit }) {
    const eventBus = inject(eventBusKey) as Emitter<Record<EventType, unknown>>
    const containerWidth = inject(containerWidthKey, ref(100))
    const rowHeight = inject(rowHeightKey, ref(10))
    const margin = inject(marginKey, ref([10, 10]))
    const maxRows = inject(maxRowsKey, ref(Infinity))
    const cols = inject(colNumKey, ref(12))
    const useCssTransforms = inject(useCssTransformsKey, ref(true))

    const dragEventSet = ref(false)
    const resizeEventSet = ref(false)

    const previousW = ref(0)
    const previousH = ref(0)
    const previousX = ref(0)
    const previousY = ref(0)
    const innerX = ref(props.x)
    const innerY = ref(props.y)
    const innerW = ref(props.w)
    const innerH = ref(props.h)

    const rtl = ref(false)
    const style = reactive({ data: { width: `${props.w}px`, height: `${props.h}px` } })
    const lastX = ref(0)
    const lastY = ref(0)
    const lastW = ref(0)
    const lastH = ref(0)
    const resizing = reactive({ data: { width: 0, height: 0 } })
    const dragging = reactive({ data: { top: 0, left: 0 } })
    const loading = ref(true)
    const itemContainer = ref<HTMLElement|null>(null)
    const handle = ref<HTMLElement|null>(null)
    let interactObj: Interactable

    /**
     * 拖拽设置函数
     */
    function tryMakeDraggable() {
      interactObj = interactObj ?? interact(itemContainer.value as HTMLElement)
      if (draggable.value && !props.static) {
        const opts = {
          ignoreFrom: props.dragIgnoreFrom,
          allowFrom: props.dragAllowFrom
        }
        interactObj.draggable(opts)
        /* this.interactObj.draggable({allowFrom: '.vue-draggable-handle'});*/
        if (!dragEventSet.value) {
          dragEventSet.value = true
          interactObj.on('dragstart dragmove dragend', (event) => {
            handleDrag(event)
          })
        }
      } else {
        interactObj.draggable({
          enabled: false
        })
      }
    }

    /**
     * 是否正在拖拽状态
     */
    const isDragging = ref(false)
    /**
     * 是否可拖拽
     */
    const draggable = toRef(props, 'isDraggable').value ? toRef(props, 'isDraggable') : inject(isDraggableKey, ref(true))
    nextTick(() => {
      watch(
        draggable,
        () => {
          tryMakeDraggable()
        },
        { immediate: true }
      )
    })

    /**
     * 缩放设置函数
     */
    function tryMakeResizable() {
      interactObj = interactObj ?? interact(itemContainer.value as HTMLElement)
      if (draggable.value && !props.static) {
        const maximum = calcPosition(0, 0, props.maxW, props.maxH)
        const minimum = calcPosition(0, 0, props.minW, props.minH)
        const opts = {
          preserveAspectRatio: true,
          edges: {
            left: renderRtl.value && `.${resizableHandleClass.value.trim().replace(' ', '.')}`,
            right: renderRtl.value ? false : `.${resizableHandleClass.value.trim().replace(' ', '.')}`,
            bottom: `.${resizableHandleClass.value.trim().replace(' ', '.')}`,
            top: false
          },
          ignoreFrom: props.resizeIgnoreFrom,
          restrictSize: {
            min: {
              height: minimum.height,
              width: minimum.width
            },
            max: {
              height: maximum.height,
              width: maximum.width
            }
          }
        }
        interactObj.resizable(opts)
        if (!resizeEventSet.value) {
          resizeEventSet.value = true
          interactObj.on('resizestart resizemove resizeend', (event: MouseEvent) => {
            handleResize(event)
          })
        }
      } else {
        interactObj.resizable({
          enabled: false
        })
      }
    }

    /**
     * 是否正在缩放状态
     */
    const isResizing = ref(false)
    // 是否可缩放
    const resizable = computed(() => {
      // 子元素可缩放，再看父容器是否可缩放
      if (props.isResizable) {
        return inject(isResizableKey, ref(true))
      }
      // 子元素不可缩放，就不可以缩放
      return false
    })
    nextTick(() => {
      watch(
        resizable,
        () => {
          tryMakeResizable()
        },
        { immediate: true }
      )
    })

    // static 状态重置缩放和拖拽
    watch(
      () => props.static,
      () => {
        tryMakeDraggable()
        tryMakeResizable()
      }
    )

    const createStyle = () => {
      if (props.x + props.w > cols.value) {
        innerX.value = 0
        innerW.value = props.w > cols.value ? cols.value : props.w
      } else {
        innerX.value = props.x
        innerW.value = props.w
      }
      const pos = calcPosition(innerX.value, innerY.value, innerW.value, innerH.value)
      if (isDragging.value) {
        pos.top = dragging.data.top
        // Add rtl support
        if (renderRtl.value) {
          pos.right = dragging.data.left
        } else {
          pos.left = dragging.data.left
        }
      }
      if (isResizing.value) {
        pos.width = resizing.data.width
        pos.height = resizing.data.height
      }
      let _style = null
      // CSS Transforms support (default)
      if (useCssTransforms) {
        // Add rtl support
        if (renderRtl.value) {
          _style = setTransformRtl(pos.top, pos.right as number, pos.width, pos.height)
        } else {
          _style = setTransform(pos.top, pos.left as number, pos.width, pos.height)
        }
      } else {
        // top,left (slow)
        // Add rtl support
        if (renderRtl.value) {
          _style = setTopRight(pos.top, pos.right as number, pos.width, pos.height)
        } else {
          _style = setTopLeft(pos.top, pos.left as number, pos.width, pos.height)
        }
      }
      style.data = _style
    }
    createStyle()
    onMounted(() => {
      createStyle()
      const compact = () => {
        createStyle()
      }
      const compactHandler = () => {
        compact()
      }
      eventBus.on('compact', compactHandler)
      // TODO 零时性修复重绘问题
      let timer = setTimeout(() => {
        loading.value = false
        clearTimeout(timer)
        timer = null
      }, 0)
      onBeforeUnmount(() => {
        eventBus.off('compact', compactHandler)
      })
    })

    const resizableAndNotStatic = computed(() => {
      // 固定模式，不允许缩放
      if (props.static) {
        return false
      }
      return resizable.value
    })

    // 镜像反转
    const isMirrored = inject(isMirroredKey, ref(false))
    const renderRtl = computed(() => (isMirrored.value ? !rtl.value : rtl.value))
    const isAndroid = computed(() => navigator.userAgent.toLowerCase().indexOf('android') !== -1)
    const draggableOrResizableAndNotStatic = computed(() => (draggable.value || resizable.value) && !props.static)
    const classObj = computed(() => ({
      'vue-grid-item': true,
      'vue-resizable': resizableAndNotStatic.value,
      static: props.static,
      resizing: isResizing.value,
      'vue-draggable-dragging': isDragging.value,
      cssTransforms: useCssTransforms.value,
      'render-rtl': renderRtl.value,
      'disable-userselect': isDragging.value,
      'no-touch': isAndroid.value && draggableOrResizableAndNotStatic.value
    }))
    const resizableHandleClass = computed(() => {
      if (renderRtl.value) {
        return 'vue-resizable-handle vue-rtl-resizable-handle'
      }
      return 'vue-resizable-handle'
    })

    // TODO layout margin 触发变化
    // watch(
    //   () => attrs.margin,
    //   (LayoutMargin: number[]) => {
    //     if (!LayoutMargin || (LayoutMargin[0] === margin[0] && LayoutMargin[1] === margin[1])) {
    //       return
    //     }
    //     margin = LayoutMargin.map(m => Number(m))
    //     createStyle()
    //     emitContainerResized()
    //   }
    // )

    // Helper for generating column width
    const calcColWidth = () => (containerWidth.value - (margin.value[0] || 10) * (cols.value + 1)) / cols.value
    const calcXY = (top: number, left: number) => {
      const colWidth = calcColWidth()
      // left = colWidth * x + margin * (x + 1)
      // l = cx + m(x+1)
      // l = cx + mx + m
      // l - m = cx + mx
      // l - m = x(c + m)
      // (l - m) / (c + m) = x
      // x = (left - margin) / (coldWidth + margin)
      let x = Math.round((left - margin.value[0]) / (colWidth + margin.value[0]))
      let y = Math.round((top - margin.value[1]) / (rowHeight.value + margin.value[1]))
      // Capping
      x = Math.max(Math.min(x, cols.value - innerW.value), 0)
      y = Math.max(Math.min(y, maxRows.value - innerH.value), 0)
      return { x, y }
    }
    const handleDrag = (event: any) => {
      if (props.static) return
      if (isResizing.value) return
      const position = getControlPosition(event)
      // Get the current drag point from the event. This is used as the offset.
      if (position === null) return // not possible but satisfies flow
      const { x, y } = position
      // let shouldUpdate = false;
      const newPosition = { top: 0, left: 0 }
      switch (event.type) {
        case 'dragstart': {
          previousX.value = innerX.value
          previousY.value = innerY.value
          const parentRect = event.target.offsetParent.getBoundingClientRect()
          const clientRect = event.target.getBoundingClientRect()
          if (renderRtl.value) {
            newPosition.left = (clientRect.right - parentRect.right) * -1
          } else {
            newPosition.left = clientRect.left - parentRect.left
          }
          newPosition.top = clientRect.top - parentRect.top
          dragging.data = newPosition
          isDragging.value = true
          break
        }
        case 'dragend': {
          if (!isDragging.value) return
          const parentRect = event.target.offsetParent.getBoundingClientRect()
          const clientRect = event.target.getBoundingClientRect()
          // Add rtl support
          if (renderRtl.value) {
            newPosition.left = (clientRect.right - parentRect.right) * -1
          } else {
            newPosition.left = clientRect.left - parentRect.left
          }
          newPosition.top = clientRect.top - parentRect.top
          dragging.data = { top: 0, left: 0 }
          isDragging.value = false
          // shouldUpdate = true;
          break
        }
        case 'dragmove': {
          const coreEvent = createCoreData(lastX.value, lastY.value, x, y)
          // Add rtl support
          if (renderRtl.value) {
            newPosition.left = dragging.data.left - coreEvent.deltaX
          } else {
            newPosition.left = dragging.data.left + coreEvent.deltaX
          }
          newPosition.top = dragging.data.top + coreEvent.deltaY
          dragging.data = newPosition
          break
        }
        default:
        // ...
      }
      // Get new XY
      let pos = null
      if (renderRtl.value) {
        pos = calcXY(newPosition.top, newPosition.left)
      } else {
        pos = calcXY(newPosition.top, newPosition.left)
      }
      lastX.value = x
      lastY.value = y
      if (innerX.value !== pos.x || innerY.value !== pos.y) {
        emit('move', props.i, pos.x, pos.y)
      }
      if (event.type === 'dragend' && (previousX.value !== innerX.value || previousY.value !== innerY.value)) {
        emit('moved', props.i, pos.x, pos.y)
      }
      eventBus.emit('dragEvent', {
        eventType: event.type,
        i: props.i,
        x: pos.x,
        y: pos.y,
        h: innerH.value,
        w: innerW.value
      })
    }

    function calcPosition(x: number, y: number, w: number, h: number, Rtl = renderRtl.value) {
      const colWidth = calcColWidth()
      // add rtl support
      let out
      if (Rtl) {
        out = {
          right: Math.round(colWidth * x + (x + 1) * margin.value[0]),
          top: Math.round(rowHeight.value * y + (y + 1) * margin.value[1]),
          // 0 * Infinity === NaN, which causes problems with resize constriants;
          // Fix this if it occurs.
          // Note we do it here rather than later because Math.round(Infinity) causes deopt
          width: w === Infinity ? w : Math.round(colWidth * w + Math.max(0, w - 1) * margin.value[0]),
          height: h === Infinity ? h : Math.round(rowHeight.value * h + Math.max(0, h - 1) * margin.value[1])
        }
      } else {
        out = {
          left: Math.round(colWidth * x + (x + 1) * margin.value[0]),
          top: Math.round(rowHeight.value * y + (y + 1) * margin.value[1]),
          // 0 * Infinity === NaN, which causes problems with resize constriants;
          // Fix this if it occurs.
          // Note we do it here rather than later because Math.round(Infinity) causes deopt
          width: w === Infinity ? w : Math.round(colWidth * w + Math.max(0, w - 1) * margin.value[0]),
          height: h === Infinity ? h : Math.round(rowHeight.value * h + Math.max(0, h - 1) * margin.value[1])
        }
      }
      return out
    }

    /**
     * Given a height and width in pixel values, calculate grid units.
     * @param  {Number} height Height in pixels.
     * @param  {Number} width  Width in pixels.
     * @param  {Boolean} autoSizeFlag  function autoSize identifier.
     * @return {Object} w, h as grid units.
     */
    const calcWH = (height: number, width: number, autoSizeFlag = false) => {
      const colWidth = calcColWidth()
      // width = colWidth * w - (margin * (w - 1))
      // ...
      // w = (width + margin) / (colWidth + margin)
      let w = Math.round((width + margin.value[0]) / (colWidth + margin.value[0]))
      let h = 0
      if (!autoSizeFlag) {
        h = Math.round((height + margin.value[1]) / (rowHeight.value + margin.value[1]))
      } else {
        h = Math.ceil((height + margin.value[1]) / (rowHeight.value + margin.value[1]))
      }
      // Capping
      w = Math.max(Math.min(w, cols.value - innerX.value), 0)
      h = Math.max(Math.min(h, maxRows.value - innerY.value), 0)
      return { w, h }
    }
    const handleResize = (event: MouseEvent) => {
      if (props.static) return
      const position = getControlPosition(event)
      // Get the current drag point from the event. This is used as the offset.
      if (position === null) return // not possible but satisfies flow
      const { x, y } = position
      const newSize = { width: 0, height: 0 }
      let pos = null
      switch (event.type) {
        case 'resizestart': {
          previousW.value = innerW.value
          previousH.value = innerH.value
          pos = calcPosition(innerX.value, innerY.value, innerW.value, innerH.value)
          newSize.width = pos.width
          newSize.height = pos.height
          resizing.data = newSize
          isResizing.value = true
          break
        }
        case 'resizemove': {
          const coreEvent = createCoreData(lastW.value, lastH.value, x, y)
          if (renderRtl.value) {
            newSize.width = resizing.data.width - coreEvent.deltaX
          } else {
            newSize.width = resizing.data.width + coreEvent.deltaX
          }
          newSize.height = resizing.data.height + coreEvent.deltaY
          resizing.data = newSize
          break
        }
        case 'resizeend': {
          pos = calcPosition(innerX.value, innerY.value, innerW.value, innerH.value)
          newSize.width = pos.width
          newSize.height = pos.height
          resizing.data = { width: 0, height: 0 }
          isResizing.value = false
          break
        }
        default:
        // ...
      }
      // Get new WH
      pos = calcWH(newSize.height, newSize.width)
      if (pos.w < props.minW) {
        pos.w = props.minW
      }
      if (pos.w > props.maxW) {
        pos.w = props.maxW
      }
      if (pos.h < props.minH) {
        pos.h = props.minH
      }
      if (pos.h > props.maxH) {
        pos.h = props.maxH
      }
      if (pos.h < 1) {
        pos.h = 1
      }
      if (pos.w < 1) {
        pos.w = 1
      }
      lastW.value = x
      lastH.value = y
      if (innerW.value !== pos.w || innerH.value !== pos.h) {
        emit('resize', props.i, pos.h, pos.w, newSize.height, newSize.width)
      }
      if (event.type === 'resizeend' && (previousW.value !== innerW.value || previousH.value !== innerH.value)) {
        emit('resized', props.i, pos.h, pos.w, newSize.height, newSize.width)
      }
      eventBus.emit('resizeEvent', {
        eventType: event.type,
        i: props.i,
        x: innerX.value,
        y: innerY.value,
        h: pos.h,
        w: pos.w
      })
    }

    const emitContainerResized = () => {
      // this.style has width and height with trailing 'px'. The
      // resized event is without them
      const styleProps: {
        height: string
        width: string
      } = { height: '0px', width: '0px' }
      const arr: ['width', 'height'] = ['width', 'height']
      for (const prop of arr) {
        const val = style.data[prop]
        const matches = val.match(/^(\d+)px$/)
        if (!matches) return
        styleProps[prop] = matches[1]
      }
      emit('container-resized', props.i, props.h, props.w, styleProps.height, styleProps.width)
    }
    watch(
      () => renderRtl.value,
      () => {
        tryMakeResizable()
        createStyle()
      }
    )
    watch([containerWidth, cols], () => {
      tryMakeResizable()
      createStyle()
      emitContainerResized()
    })

    watch([() => props.minH, () => props.maxH, () => props.minW, () => props.maxW], () => {
      tryMakeResizable()
    })
    watch(
      rowHeight,
      () => {
        createStyle()
        emitContainerResized()
      }
      // { immediate: true }
    )

    watch(
      () => props.x,
      (newVal) => {
        innerX.value = newVal
        createStyle()
      }
      // { immediate: true }
    )
    watch(
      () => props.y,
      (newVal) => {
        innerY.value = newVal
        createStyle()
      }
      // { immediate: true }
    )
    watch(
      () => props.h,
      (newVal) => {
        innerH.value = newVal
        createStyle()
      }
      // { immediate: true }
    )
    watch(
      () => props.w,
      (newVal) => {
        innerW.value = newVal
        createStyle()
      }
      // { immediate: true }
    )

    return {
      classObj,
      style,
      resizableHandleClass,
      resizableAndNotStatic,
      itemContainer,
      handle,
      dragging,
      loading,
      calcXY
    }
  },
  render() {
    const renderContent = () => {
      if (this.loading) {
        if (typeof this.$slots.lading === 'function') {
          return this.$slots.lading()
        }
        return null
      }
      return this.$slots.default?.()
    }
    return (
      <div
        ref='itemContainer'
        class={this.classObj}
        style={this.style.data}>
        {renderContent()}
        {this.resizableAndNotStatic ? (
          <span ref='handle' class={this.resizableHandleClass}></span>
        ) : ''}
      </div>
    )
  }
})
