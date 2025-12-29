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
- [x] Results should have scrollbar to show list size perspective
- [x] Long file paths should show tooltip when truncated
- [x] Wrong width distribution causing horizontal scrollbar when clicking lines
- [x] "File" option in scope select seems unnecessary

## **Project Input Issues**
- [x] Weird behavior when changing modes (shows "all files" instead of folder path)

## **Button/Icon Quality Issues**
- [x] Search widget has bad quality icons
- [x] Results buttons are different from design, lower quality
- [x] Replace button quality issues
- [x] No select borders on various elements

## **Border/Selection Issues**
- [x] Weird selection borders throughout UI
- [x] Need higher quality, consistent borders
- [x] Use single border with fitting color (like selected text color) for all buttons/inputs

## **Preview Panel Quality Issues**
- [ ] Replace buttons are much better in design
- [ ] Filepath should show below filename with good colors
- [ ] Line numbers and content start should have smaller width
- [ ] Need high level of color distinction throughout preview
- [ ] Selected line, selected word, non-result lines should all be visually distinct

## **Theme Issues**
- [x] UI should not follow VSCode current theme but use its own custom theme
- [x] This would allow using all design details properly

## **Switch Sidebar Issues**
- [x] Pressing switch between sidebar multiple times shows weird implementation results
- [x] When switching between sidebar and tab, and make tab thiner, sidebar is shown. if user switches between sidebar and tab - only tab should be displayed.

## **Settings Issues**
- [x] Add setting option to show results on every search with files collapsed

## **Results List Bug**
- [x] Scrolling bug: when many file results in collapse all mode, scrolling below viewport sends scroll to top
- [x] add scroll to file with more than 5 results

## **General Feedback**
- [ ] Need proper usability testing to catch implementation issues