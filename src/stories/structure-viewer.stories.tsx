import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { expect, within } from 'storybook/test'

import { StructureViewer } from '../viewer/structure-viewer'

const meta: Meta<typeof StructureViewer> = {
  title: 'Viewer/StructureViewer',
  component: StructureViewer,
  // Served by the MSW handlers in src/mocks (see .storybook/preview.tsx).
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof StructureViewer>

export const CastleKeep: Story = {
  args: { name: 'castle-keep' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('castle-keep')).toBeInTheDocument()
    await expect(await canvas.findByText('176 blocks')).toBeInTheDocument()
    await expect(await canvas.findByText('8 × 6 × 8')).toBeInTheDocument()
    await expect(await canvas.findByRole('button', { name: 'Hide Castle' })).toBeInTheDocument()
    // The SSE handler marks the connection as live shortly after mount.
    await expect(await canvas.findByText('Live')).toBeInTheDocument()
  },
}

export const FailingEdit: Story = {
  args: { name: 'windmill' },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Showing the last good build/)).toBeInTheDocument()
  },
}

export const EmptyCanvas: Story = {
  args: { name: 'empty-canvas' },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('This structure is empty.')).toBeInTheDocument()
  },
}

export const BrokenStructure: Story = {
  args: { name: 'broken-structure' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('The builder agent lost this structure.'),
    ).toBeInTheDocument()
  },
}
