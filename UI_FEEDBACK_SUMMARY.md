# Rifler UI Feedback Summary

Based on GitHub comment feedback from Issue #83, here's a comprehensive list of issues identified:

## **UI Quality & Completeness Issues**
- [ ] UI doesn't feel pristine as the design - many small details missing from filters, results, and preview
- [ ] Lacking and somewhat different colors - UI feels bland
- [ ] Implementation not yet complete - missing elements from all 3 parts (filter, results, preview)

## **Bundle Size Issues**
- [x] Size increased dramatically from <2MB to 21MB+ - something was done wrong

## **Preview Panel Issues**
- [x] No toggle on preview or hide/show functionality
- [x] Drag and drop doesn't feel fluid for usage experience
- [x] Need better UX for switching between seeing more results vs seeing preview
- [x] Preview panel UI takes too much space and stays on top of content
- [x] Should be integrated into UI (like filters) in 1-2 lines rather than 3

## **File Icons Issues**
- [x] File icons not using VSCode's native icons
- [x] Current icons lack distinction - only 2 types with basic colors (white, blue, orange)
- [x] Should use proper file icons for rapid visual distinction

## **Preview Title Issues**
- [x] Preview title missing file path
- [x] Path would be useful for projects with many files

## **Results List Issues**
- [ ] Results should have scrollbar to show list size perspective
- [ ] Long file paths should show tooltip when truncated
- [ ] Wrong width distribution causing horizontal scrollbar when clicking lines
- [ ] "File" option in scope select seems unnecessary

## **Filter/Scope Issues**
- [ ] Weird selection borders that shouldn't be there
- [ ] Collapse All button doesn't change to Expand All after collapsing
- [ ] Select dropdown has different colors than theme
- [ ] Clicking prefix word doesn't open select dropdown
- [ ] Input mask requires "*. " prefix - should be simplified to just "ts,sh,md"
- [ ] Change prefix to "File Ext(s):" for clarity

## **Project Input Issues**
- [ ] Project input not editable in Project mode but behaves like it is
- [ ] Cursor should change and input shouldn't be selectable in Project mode
- [ ] Weird behavior when changing modes (shows "all files" instead of folder path)

## **Button/Icon Quality Issues**
- [ ] Search widget has bad quality icons
- [ ] Results buttons are different from design, lower quality
- [ ] Replace button quality issues
- [ ] No select borders on various elements

## **Border/Selection Issues**
- [ ] Weird selection borders throughout UI
- [ ] Need higher quality, consistent borders
- [ ] Use single border with fitting color (like selected text color) for all buttons/inputs

## **Performance/Loading Issues**
- [ ] Rust support should be in milliseconds, not current performance
- [ ] Weird loading behavior when opening extension first time after VSCode opens
- [ ] Loading more scripts online than necessary
- [ ] Make all scripts local-only for instant extension opening

## **Preview Panel Quality Issues**
- [ ] Replace buttons are much better in design
- [ ] Filepath should show below filename with good colors
- [ ] Line numbers and content start should have smaller width
- [ ] Need high level of color distinction throughout preview
- [ ] Selected line, selected word, non-result lines should all be visually distinct

## **Theme Issues**
- [ ] UI should not follow VSCode current theme but use its own custom theme
- [ ] This would allow using all design details properly

## **Input Mask Clarity Issues**
- [ ] No clear distinction in current icons for file types
- [ ] Make input mask options and usage more clear

## **Module/Project Mode Issues**
- [ ] Module: Project mode not editable
- [ ] Directory mode is editable - unclear why there are two similar modes

## **Initial Load Issues**
- [ ] First extension seen with initial load behavior
- [ ] What exactly is being deferred during load?
- [ ] Responsiveness is important - deferring affects user experience

## **Close Button Issues**
- [ ] Close button clears search input instead of closing extension tab

## **Switch Sidebar Issues**
- [ ] Pressing switch between sidebar multiple times shows weird implementation results

## **Settings Issues**
- [ ] Add setting option to show results on every search with files collapsed

## **Results List Bug**
- [ ] Scrolling bug: when many file results in collapse all mode, scrolling below viewport sends scroll to top

## **Preview Functionality**
- [ ] Missing show/hide preview functionality - poor user experience

## **General Feedback**
- [ ] Extension should be distinct and better than alternatives
- [ ] Focus on distinction through colors and other visual elements
- [ ] Need proper usability testing to catch implementation issues</content>
<parameter name="filePath">/Users/ori.roza/Desktop/projects/rifler/UI_FEEDBACK_SUMMARY.md