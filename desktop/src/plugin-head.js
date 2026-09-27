import {
  atom,
  Codicon,
  COMPOSER_AREAS,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  GlyphSpinner,
  host,
  Kbd,
  ListRow,
  ModelCatalogMenu,
  ModelMenuCloseContext,
  PALETTE_AREA,
  reasoningEffortLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tip,
  ToggleRow,
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Component, Fragment, useEffect, useState } from 'react'

const ID = 'prompt-studio'

