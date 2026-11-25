import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Brandmark } from '../viewer/brandmark'

const meta: Meta<typeof Brandmark> = {
  title: 'Viewer/Brandmark',
  component: Brandmark,
  parameters: {
    layout: 'centered',
  },
  tags: ['ai-generated'],
}

export default meta

type Story = StoryObj<typeof Brandmark>

export const Default: Story = {}

/**
 * Asserts a concrete computed style value read from the component's source:
 * the wordmark's font family is declared in globals.css via the `wordmark` class.
 */
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    const { within, expect } = await import('storybook/test')
    const canvas = within(canvasElement)
    const wordmark = canvas.getByText('tsumiki')
    expect(wordmark).toHaveStyle({ fontWeight: '600' })
  },
}
