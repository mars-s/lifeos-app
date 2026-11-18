SELECT json_object(
  'areas', (
    SELECT json_group_array(json_object('uuid', uuid, 'title', coalesce(title, ''), 'index', coalesce("index", 0)))
    FROM TMArea
  ),
  'tags', (
    SELECT json_group_array(json_object('uuid', uuid, 'title', coalesce(title, ''), 'index', coalesce("index", 0)))
    FROM TMTag
  ),
  'items', (
    SELECT json_group_array(json_object(
      'uuid', uuid,
      'type', type,
      'title', coalesce(title, ''),
      'notes', coalesce(notes, ''),
      'status', status,
      'trashed', json(CASE WHEN trashed = 1 THEN 'true' ELSE 'false' END),
      'start', start,
      'startDate', startDate,
      'evening', json(CASE WHEN startBucket = 1 THEN 'true' ELSE 'false' END),
      'deadline', deadline,
      'stopDate', stopDate,
      'modifiedAt', userModificationDate,
      'index', coalesce("index", 0),
      'todayIndex', coalesce(todayIndex, 0),
      'area', area,
      'project', project,
      'heading', heading,
      'repeating', json(CASE WHEN rt1_recurrenceRule IS NOT NULL THEN 'true' ELSE 'false' END),
      'tags', (SELECT json_group_array(tags) FROM TMTaskTag WHERE TMTaskTag.tasks = TMTask.uuid)
    ))
    FROM TMTask
  ),
  'checklistItems', (
    SELECT json_group_array(json_object(
      'uuid', uuid,
      'task', task,
      'title', coalesce(title, ''),
      'status', status,
      'index', coalesce("index", 0)
    ))
    FROM TMChecklistItem
  )
);
