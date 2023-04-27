<template>
  <div ref="layoutContainer" class="vue-grid-layout" :style="mergedStyle">
    <slot></slot>
    <grid-item
      v-show="isDragging"
      ref="gridItem"
      class="vue-grid-placeholder"
      :x="placeholder.x"
      :y="placeholder.y"
      :w="placeholder.w"
      :h="placeholder.h"
      :i="placeholder.i"
    ></grid-item>
  </div>
</template>
<script lang="ts">
import { defineComponent, nextTick, onBeforeUnmount, onMounted, PropType, provide, reactive, ref, toRef, watch } from 'vue';

import mitt from 'mitt';
import {
  bottom,
  cloneLayout,
  compact,
  getAllCollisions,
  getLayoutItem,
  Layout,
  moveElement,
  validateLayout,
  eventBusKey,
  parentRootKey,
  isDraggableKey,
  isResizableKey,
  rowHeightKey,
  maxRowsKey,
  colNumKey,
  containerWidthKey,
  marginKey,
  useCssTransformsKey,
  isMirroredKey,
  LayoutItem,
} from './helpers/utils';
import {
  findOrGenerateResponsiveLayout,
  getBreakpointFromWidth,
  getColsFromBreakpoint,
} from './helpers/responsive-utils';
import { useResizeObserver } from '@vueuse/core';
import './GridLayout.css';
import GridItem from './GridItem.vue';

export default defineComponent({
  name: 'GridLayout',
  components: { GridItem },
  emits: [
    'layout-created',
    'layout-mounted',
    'layout-before-mount',
    'layout-updated',
    'layout-ready',
    'update:layout',
    'breakpoint-changed',
  ],
  props: {
    /**
     * Layout 容器是否自动调整大小，以容纳所有 Item
     */
    autoSize: {
      type: Boolean,
      default: true,
    },
    /**
     * 定义栅格系统的列数
     */
    colNum: {
      type: Number,
      default: 12,
    },
    /**
     * 栅格每行的高度，单位像素
     */
    rowHeight: {
      type: Number,
      default: 10,
    },
    /**
     * 最大行数
     */
    maxRows: {
      type: Number,
      default: Infinity,
    },
    /**
     * 定义栅格中的元素边距。值必须是包含两个 Number的数组，数组中第一个元素表示水平边距，第二个表示垂直边距，单位为像素。
     */
    margin: {
      type: Array as PropType<number[]>,
      default: () => [10, 10],
    },
    /**
     * 栅格中的元素是否可拖拽
     */
    isDraggable: {
      type: Boolean,
      default: true,
    },
    /**
     * 栅格中的元素是否可调整大小。
     */
    isResizable: {
      type: Boolean,
      default: true,
    },
    /**
     * 栅格中的元素是否可镜像反转。
     */
    isMirrored: {
      type: Boolean,
      default: false,
    },
    /**
     * 是否使用CSS属性 transition-property: transform;
     */
    useCssTransforms: {
      type: Boolean,
      default: true,
    },
    /**
     * 布局是否垂直压缩。
     */
    verticalCompact: {
      type: Boolean,
      default: true,
    },
    /**
     * 栅格的初始布局。值必须为 Array，其数据项为 Object。 每条数据项必须有 i, x, y, w 和 h 属性。
     */
    layout: {
      type: Array as PropType<Layout>,
      required: true,
    },
    /**
     * 布局是否为响应式。
     */
    responsive: {
      type: Boolean,
      default: false,
    },
    /**
     * 如果 responsive 设置为 true，该配置将作为栅格中每个断点的初始布局。
     * 键值是断点名称，每项的值都是类似 layout 属性定义的数据结构，值必须为 Array，其数据项为 Object。
     * 例如： {lg: [layout items], md: [layout items]}。需要注意的是，在创建栅格布局后设置该属性无效。
     * 在创建GridLayout之后设置prop无效。
     */
    responsiveLayouts: {
      type: Object,
      default: () => ({}),
    },
    /**
     * 为响应式布局设置断点。
     */
    breakpoints: {
      type: Object,
      default: () => ({ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }),
    },
    /**
     * 设置每个断点对应的列数。
     */
    responsiveCols: {
      type: Object,
      default: () => ({ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }),
    },
    /**
     * 防止碰撞属性，值设置为 true 时，栅格只能拖动至空白处。
     */
    preventCollision: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const eventBus = mitt();
    const layoutContainer = ref(null);
    provide(eventBusKey, eventBus);
    provide(parentRootKey, layoutContainer);
    provide(isDraggableKey, toRef(props, 'isDraggable'));
    provide(isResizableKey, toRef(props, 'isResizable'));
    provide(isMirroredKey, toRef(props, 'isMirrored'));
    provide(rowHeightKey, toRef(props, 'rowHeight'));
    provide(maxRowsKey, toRef(props, 'maxRows'));
    provide(colNumKey, toRef(props, 'colNum'));
    provide(marginKey, toRef(props, 'margin'));
    provide(useCssTransformsKey, toRef(props, 'useCssTransforms'));

    const width = ref(100);
    useResizeObserver(layoutContainer, (entries) => {
      const entry = entries[0];
      width.value = entry.contentRect.width;
      // 容器大小变化，更新容器高度
      updateHeight();
    });
    provide(containerWidthKey, width);

    const mergedStyle = ref({});
    const isDragging = ref(false);
    const placeholder = reactive<{
      x: number
      y: number
      w: number
      h: number
      i: number | string
    }>({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      i: -1,
    });
    let layouts: any = {};
    let lastBreakpoint: string | null = null; // store last active breakpoint
    let originalLayout: Layout; // store original Layout

    const containerHeight = () => {
      if (!props.autoSize) return;
      const buffer = 15; // 最下面的元素无法操作，留一点缓冲
      return `${bottom(props.layout) * (props.rowHeight + props.margin[1]) + props.margin[1] + buffer}px`;
    };

    const updateHeight = () => {
      mergedStyle.value = {
        height: containerHeight(),
      };
    };
    const findDifference = (layout: Layout, originalLayout: Layout) => {
      // Find values that are in result1 but not in result2
      const uniqueResultOne = layout.filter(obj => !originalLayout.some(obj2 => obj.i === obj2.i));
      // Find values that are in result2 but not in result1
      const uniqueResultTwo = originalLayout.filter(obj => !layout.some(obj2 => obj.i === obj2.i));
      // Combine the two arrays of unique entries#
      return uniqueResultOne.concat(uniqueResultTwo);
    };
    // clear all responsive layouts
    const initResponsiveFeatures = () => {
      // clear layouts
      layouts = Object.assign({}, props.responsiveLayouts);
    };
    const layoutUpdate = () => {
      if (props.layout !== undefined) {
        if (props.layout.length !== originalLayout.length) {
          const diff = findDifference(props.layout, originalLayout);
          if (diff.length > 0) {
            if (props.layout.length > originalLayout.length) {
              originalLayout = originalLayout.concat(diff);
            } else {
              originalLayout = originalLayout.filter(obj => !diff.some(obj2 => obj.i === obj2.i));
            }
          }
          initResponsiveFeatures();
        }
        compact(props.layout, props.verticalCompact);
        updateHeight();
        emit('layout-updated', props.layout);
      }
    };
    watch([() => props.layout.length, () => props.layout, () => props.margin], () => {
      layoutUpdate();
    });

    watch(
      () => props.responsive,
      () => {
        if (!props.responsive) {
          emit('update:layout', originalLayout);
          // eventBus.emit('setColNum', props.colNum)
        }
        // onWindowResize()
      },
    );
    // finds or generates new layouts for set breakpoints
    const responsiveGridLayout = () => {
      const newBreakpoint = getBreakpointFromWidth(props.breakpoints, width.value);
      const newCols = getColsFromBreakpoint(newBreakpoint, props.responsiveCols);
      // save actual layout in layouts
      if (lastBreakpoint !== null && !layouts[lastBreakpoint]) layouts[lastBreakpoint] = cloneLayout(props.layout);
      // Find or generate a new layout.
      const layout = findOrGenerateResponsiveLayout(
        originalLayout,
        layouts,
        props.breakpoints,
        newBreakpoint,
        lastBreakpoint as string,
        newCols,
        props.verticalCompact,
      );
      // Store the new layout.
      layouts[newBreakpoint] = layout;
      if (lastBreakpoint !== newBreakpoint) {
        emit('breakpoint-changed', newBreakpoint, layout);
      }
      // new prop sync
      emit('update:layout', layout);
      lastBreakpoint = newBreakpoint;
      eventBus.emit('setColNum', getColsFromBreakpoint(newBreakpoint, props.responsiveCols));
    };

    const resizeEvent = (eventName: string, id: string | number, x: number, y: number, h: number, w: number) => {
      let l = getLayoutItem(props.layout, id) as LayoutItem;
      // GetLayoutItem sometimes return null object
      if (l === undefined || l === null) {
        l = { h: 0, w: 0, x: 0, y: 0, i: id };
      }
      let hasCollisions = false;
      if (props.preventCollision) {
        const collisions = getAllCollisions(props.layout, {
          ...l,
          w,
          h,
        }).filter(layoutItem => layoutItem.i !== l.i);
        hasCollisions = collisions.length > 0;
        // If we're colliding, we need adjust the placeholder.
        if (hasCollisions) {
          // adjust w && h to maximum allowed space
          let leastX = Infinity;
          let leastY = Infinity;
          collisions.forEach((layoutItem) => {
            if (layoutItem.x > l.x) leastX = Math.min(leastX, layoutItem.x);
            if (layoutItem.y > l.y) leastY = Math.min(leastY, layoutItem.y);
          });
          if (Number.isFinite(leastX)) l.w = leastX - l.x;
          if (Number.isFinite(leastY)) l.h = leastY - l.y;
        }
      }
      if (!hasCollisions) {
        // Set new width and height.
        l.w = w;
        l.h = h;
      }
      if (eventName === 'resizestart' || eventName === 'resizemove') {
        placeholder.i = id;
        placeholder.x = x;
        placeholder.y = y;
        placeholder.w = l.w;
        placeholder.h = l.h;
        nextTick(() => {
          isDragging.value = true;
        });
        // this.$broadcast("updateWidth", this.width);
        // eventBus.emit('updateWidth', width.value)
      } else {
        nextTick(() => {
          isDragging.value = false;
        });
      }
      if (props.responsive) responsiveGridLayout();
      compact(props.layout, props.verticalCompact);
      eventBus.emit('compact');
      updateHeight();
      if (eventName === 'resizeend') emit('layout-updated', props.layout);
    };

    // Accessible references of functions for removing in beforeDestroy
    function resizeEventHandler({
      eventType,
      i,
      x,
      y,
      h,
      w,
    }: {
      eventType: string
      i: string | number
      x: number
      y: number
      h: any
      w: any
    }) {
      resizeEvent(eventType, i, x, y, h, w);
    }

    const dragEvent = (eventName: string, id: string | number, x: number, y: number, h: number, w: number) => {
      // console.log(eventName + " id=" + id + ", x=" + x + ", y=" + y);
      let l = getLayoutItem(props.layout, id);
      // GetLayoutItem sometimes returns null object
      if (l === undefined || l === null) {
        l = { h: 0, w: 0, x: 0, y: 0, i: id };
      }
      if (eventName === 'dragmove' || eventName === 'dragstart') {
        placeholder.i = id;
        placeholder.x = l.x;
        placeholder.y = l.y;
        placeholder.w = w;
        placeholder.h = h;
        nextTick(() => {
          isDragging.value = true;
        });
        // eventBus.emit('updateWidth', width.value)
      } else {
        nextTick(() => {
          isDragging.value = false;
        });
      }
      // Move the element to the dragged location.
      moveElement(props.layout, l, x, y, true, props.preventCollision);
      compact(props.layout, props.verticalCompact);
      // needed because vue can't detect changes on array element properties
      eventBus.emit('compact');
      updateHeight();
      if (eventName === 'dragend') emit('layout-updated', props.layout);
    };
    const dragEventHandler = ({
      eventType,
      i,
      x,
      y,
      h,
      w,
    }: {
      eventType: string
      i: string | number
      x: number
      y: number
      h: any
      w: any
    }) => {
      dragEvent(eventType, i, x, y, h, w);
    };
    // @ts-ignore
    eventBus.on('resizeEvent', resizeEventHandler);
    // @ts-ignore
    eventBus.on('dragEvent', dragEventHandler);
    emit('layout-created', props.layout);
    emit('layout-before-mount', props.layout);

    onBeforeUnmount(() => {
      // Remove listeners
      // @ts-ignore
      eventBus.off('resizeEvent', resizeEventHandler);
      // @ts-ignore
      eventBus.off('dragEvent', dragEventHandler);
      // removeWindowEventListener('resize', onWindowResize)
    });

    onMounted(() => {
      emit('layout-mounted', props.layout);
      nextTick(() => {
        validateLayout(props.layout);
        originalLayout = props.layout;
        nextTick(() => {
          // onWindowResize()
          initResponsiveFeatures();
          // this.width = this.$el.offsetWidth;
          // addWindowEventListener('resize', onWindowResize)
          compact(props.layout, props.verticalCompact);
          emit('layout-updated', props.layout);
          updateHeight();
        });
      });
    });
    return {
      mergedStyle,
      isDragging,
      placeholder,
      layoutContainer,
      dragEvent,
      resizeEvent,
    };
  },
});
</script>
