local Players = game:GetService("Players")
local player = Players.LocalPlayer

-- URL server Render
local SERVER_URL = "https://websitekey.onrender.com"

-- Hàm gọi HTTP (thử các phương thức cho Codex Unc)
local function callServer(endpoint, data)
    local maxRetries = 3
    local retryDelay = 1
    local success, response

    local httpMethods = {
        function()
            if request then
                return request({ Url = SERVER_URL .. endpoint, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = game:GetService("HttpService"):JSONEncode(data or {}) })
            end
        end,
        function()
            if http_request then
                return http_request(SERVER_URL .. endpoint, game:GetService("HttpService"):JSONEncode(data or {}), "POST")
            end
        end,
        function()
            if syn and syn.request then
                return syn.request({ Url = SERVER_URL .. endpoint, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = game:GetService("HttpService"):JSONEncode(data or {}) })
            end
        end
    }

    for _, method in pairs(httpMethods) do
        for i = 1, maxRetries do
            success, response = pcall(method)
            if success and response and (response.StatusCode == 200 or response.Success) then break end
            warn("Lỗi HTTP lần " .. i .. ": " .. tostring(response and (response.Body or response) or "Không có phản hồi"))
            wait(retryDelay)
        end
        if success and response and (response.StatusCode == 200 or response.Success) then break end
    end

    if not success or not response or not (response.StatusCode == 200 or response.Success) then
        warn("Lỗi cuối cùng: " .. tostring(response and (response.Body or response) or "Executor không hỗ trợ HTTP"))
        return { status = "error", message = "Executor không hỗ trợ HTTP hoặc lỗi kết nối. Vui lòng dùng website https://websitekey.onrender.com để lấy key!" }
    end

    local decoded, result = pcall(game:GetService("HttpService").JSONDecode, game:GetService("HttpService"), response.Body or response)
    if decoded then
        return result
    else
        warn("Lỗi decode JSON: " .. tostring(result))
        return { status = "error", message = "Lỗi decode JSON: " .. tostring(result) }
    end
end

-- GUI đơn giản
local screenGui = Instance.new("ScreenGui")
screenGui.Parent = player:WaitForChild("PlayerGui")

local frame = Instance.new("Frame")
frame.Size = UDim2.new(0, 300, 0, 200)
frame.Position = UDim2.new(0.5, -150, 0.5, -100)
frame.BackgroundColor3 = Color3.new(0, 0, 0)
frame.Parent = screenGui

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, 0, 0, 30)
title.Text = "Key System"
title.BackgroundColor3 = Color3.new(0.2, 0.2, 0.2)
title.TextColor3 = Color3.new(1, 1, 1)
title.Parent = frame

local getKeyBtn = Instance.new("TextButton")
getKeyBtn.Size = UDim2.new(1, -20, 0, 30)
getKeyBtn.Position = UDim2.new(0, 10, 0, 40)
getKeyBtn.Text = "Lấy Key"
getKeyBtn.BackgroundColor3 = Color3.new(0, 0.8, 0)
getKeyBtn.TextColor3 = Color3.new(1, 1, 1)
getKeyBtn.Parent = frame

local keyBox = Instance.new("TextBox")
keyBox.Size = UDim2.new(1, -20, 0, 30)
keyBox.Position = UDim2.new(0, 10, 0, 80)
keyBox.PlaceholderText = "Nhập key hoặc shortlink sẽ hiện đây"
keyBox.Text = ""
keyBox.Parent = frame

local verifyBtn = Instance.new("TextButton")
verifyBtn.Size = UDim2.new(1, -20, 0, 30)
verifyBtn.Position = UDim2.new(0, 10, 0, 120)
verifyBtn.Text = "Check Key & Chạy Script"
verifyBtn.BackgroundColor3 = Color3.new(0.8, 0, 0)
verifyBtn.TextColor3 = Color3.new(1, 1, 1)
verifyBtn.Parent = frame

-- Lấy Key (gọi /shorten)
getKeyBtn.MouseButton1Click:Connect(function()
    keyBox.Text = "Đang lấy shortlink..."
    local result = callServer('/shorten', {})
    if result.status == "success" then
        keyBox.Text = result.shortUrl
        print("Shortlink: " .. result.shortUrl)
        -- Auto copy shortlink
        if setclipboard then
            pcall(function() setclipboard(result.shortUrl) end)
            print("Shortlink đã được copy vào clipboard!")
        else
            print("Executor không hỗ trợ setclipboard, vui lòng copy thủ công từ TextBox.")
        end
    else
        keyBox.Text = "Lỗi: " .. result.message
        warn("Lỗi lấy shortlink: " .. result.message)
    end
end)

-- Check & Run
verifyBtn.MouseButton1Click:Connect(function()
    local key = keyBox.Text
    if key == "" or string.match(key, "^https://yeumoney.com/") or string.match(key, "^Đang") or string.match(key, "^Lỗi") then
        keyBox.Text = "Vui lòng nhập key!"
        return
    end
    keyBox.Text = "Đang verify key..."
    local result = callServer('/verify', { key = key })
    if result.valid then
        frame:Destroy()
        print("Key ok! Shortlink: " .. result.shortUrl .. ", Original: " .. result.originalUrl)
        loadstring(result.script)()
    else
        keyBox.Text = "Key sai: " .. result.message
        warn("Lỗi verify: " .. result.message)
    end
end)
