import { useDocsSearch } from 'fumadocs-core/search/client'
import { staticClient } from 'fumadocs-core/search/client/orama-static'
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search'
import type { SharedProps } from 'fumadocs-ui/contexts/search'

// The index is prerendered to /api/search at build time and searched in the
// browser, so the deployed site needs no server.
const client = staticClient({ from: '/api/search' })

export default function StaticSearchDialog(props: SharedProps) {
  const search = useDocsSearch({ client })

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  )
}
