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
  KEYBINDS_AREA,
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
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
// Names added to the SDK after the oldest supported Hermes (ListRow/ToggleRow: 0.21.5) are read from
// the namespace, never imported by name: on an older Desktop a named import of a missing export
// fails to link and the whole plugin fails to load. See tests/desktop/sdk-compat.test.mjs.
import * as hermesSdk from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Component, Fragment, useEffect, useState } from 'react'

const ID = 'prompt-studio'

