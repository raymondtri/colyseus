local result = {}
for _, key in ipairs(redis.call('keys', 'roomcache:roomsUnlockedAndPublic:*')) do
    local process_id = string.sub(key, string.len('roomcache:roomsUnlockedAndPublic:') + 1)
    local rooms = {}
    local total_clients = 0
    local room_data = redis.call('hgetall', key)

    for i = 1, #room_data, 2 do
        local room_id = room_data[i]
        local client_count = tonumber(room_data[i + 1])
        table.insert(rooms, room_id)
        total_clients = total_clients + client_count
    end

    result[process_id] = {
        rooms = rooms,
        clients = total_clients
    }
end

return result