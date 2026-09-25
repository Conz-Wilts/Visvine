---
type: tool
title: Poll
description: One question, three answers, and everyone's tally
sdk: ^2
release: 1.0.0
license: MIT
surfaces:
  rail: { label: Poll, icon: grid }
collections:
  votes:
    schema:
      type: object
      properties:
        choice: { type: string, enum: [a, b, c] }
      required: [choice]
      additionalProperties: false
    read: all
    write: own
    maxRows: 20000
  notes:
    schema:
      type: object
      properties:
        text: { type: string, maxLength: 20000 }
      required: [text]
    read: own
    write: own
  pins:
    schema:
      type: object
      properties:
        at: { type: integer }
    read: all
    write: all
    maxRows: 3
---

Which answer? Everyone votes; everyone sees the tally, nobody sees who voted for what.
