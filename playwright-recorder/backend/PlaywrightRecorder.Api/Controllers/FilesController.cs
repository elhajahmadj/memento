using Microsoft.AspNetCore.Mvc;
using PlaywrightRecorder.Api.Models;
using PlaywrightRecorder.Api.Services;

namespace PlaywrightRecorder.Api.Controllers;

[ApiController]
[Route("api/files")]
public class FilesController : ControllerBase
{
    private readonly IProjectService _projects;
    private readonly IFileTreeService _tree;

    public FilesController(IProjectService projects, IFileTreeService tree)
    {
        _projects = projects;
        _tree = tree;
    }

    private string Root() => _projects.Current?.SolutionDirectory
        ?? throw new InvalidOperationException("No project loaded.");

    [HttpGet("content")]
    public ActionResult<FileContentResponse> Read([FromQuery] string path)
    {
        _tree.EnsureInsideProject(path, Root());
        if (!System.IO.File.Exists(path)) return NotFound();
        return Ok(new FileContentResponse(path, System.IO.File.ReadAllText(path)));
    }

    [HttpPost("create")]
    public ActionResult Create([FromBody] CreateFileRequest req)
    {
        _tree.EnsureInsideProject(req.Path, Root());
        var dir = Path.GetDirectoryName(req.Path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        if (System.IO.File.Exists(req.Path)) return Conflict("File already exists.");
        System.IO.File.WriteAllText(req.Path, req.Content ?? "");
        return Ok();
    }

    [HttpPut("update")]
    public ActionResult Update([FromBody] UpdateFileRequest req)
    {
        _tree.EnsureInsideProject(req.Path, Root());
        System.IO.File.WriteAllText(req.Path, req.Content);
        return Ok();
    }

    [HttpDelete("delete")]
    public ActionResult Delete([FromQuery] string path)
    {
        _tree.EnsureInsideProject(path, Root());
        if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
        return Ok();
    }

    [HttpPost("rename")]
    public ActionResult Rename([FromBody] RenameRequest req)
    {
        _tree.EnsureInsideProject(req.OldPath, Root());
        _tree.EnsureInsideProject(req.NewPath, Root());
        if (System.IO.File.Exists(req.OldPath))
            System.IO.File.Move(req.OldPath, req.NewPath, overwrite: false);
        return Ok();
    }
}
