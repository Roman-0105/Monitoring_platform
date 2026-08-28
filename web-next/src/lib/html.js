// Связывает htm (JSX-подобный синтаксис в шаблонных строках) с React.createElement —
// позволяет писать компоненты без сборщика/транспайлера JSX.
import React from 'react';
import htm from 'htm';

export const html = htm.bind(React.createElement);
