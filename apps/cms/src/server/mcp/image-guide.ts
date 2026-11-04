/**
 * How an AI client gets an image into the library. Shared by the server
 * instructions (both connectors), get_site_info and the write_post prompt, so
 * the three never drift apart.
 */
export const IMAGE_UPLOAD_INSTRUCTION = [
  'Images: choose the upload path by where the image is.',
  '1) A public direct link to the file: upload_asset_from_url.',
  '2) A file you can read from a shell (a local file in Claude Code, Codex, Cursor and similar): call create_asset_upload, send each file with curl -sS -T <file> "<uploadUrl>/" (curl -T "{a.jpg,b.png}" "<uploadUrl>/" sends several), then call get_asset_upload with finish: true. finish: true is required: it closes the link.',
  '3) Anything else, such as images the user attached to the chat: you cannot send those bytes yourself. Call create_asset_upload and give the user the pageUrl to open; they drop the images there (one link takes up to 20 files for 20 minutes). When they say they are done, call get_asset_upload.',
  'Never ask the user to host an image somewhere or to share storage credentials.',
  'get_asset_upload and get_asset return a preview of each image: look at them, decide which image goes where, and set alt text on each with update_asset_alt.',
  'Use the assetId in image fields, seo.ogImage and ![alt](asset:<assetId>). Always give alt text. If an upload from a URL fails, do not guess other URLs: ask the user for a working link, offer an upload link, or continue without the image.',
  "An external ![alt](https://...) image in rich text is copied into the media library when the entry is saved; any that could not be copied are listed in the result's warnings.",
].join(' ')

/** One line for get_site_info and the write_post prompt. */
export const IMAGE_UPLOAD_SHORT =
  'Images: upload_asset_from_url for a public link; otherwise create_asset_upload (curl the files to uploadUrl, or give the user pageUrl for chat attachments), then get_asset_upload (finish: true after curl uploads) to see previews. Use the assetId in image fields, seo.ogImage, or ![alt](asset:<assetId>), and set alt text with update_asset_alt.'
